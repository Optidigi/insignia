import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAjaxCartAdapter } from '../src/cart.ts';

const ordinary = { key: '42:ordinary', variant_id: 42, quantity: 3, properties: { Gift: 'Yes' } };
const old = {
  key: '42:old-member',
  variant_id: 42,
  quantity: 1,
  properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'old-member' },
};
const desired = [
  {
    variantId: 'gid://shopify/ProductVariant/42',
    quantity: 2,
    properties: { _insignia_quote_v2: 'new', _insignia_member_v2: 'member-0' },
  },
];
function provider(initial = [ordinary, old], hook) {
  let items = structuredClone(initial);
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method: init.method ?? 'GET', body });
    if (hook) {
      const result = await hook({ url, body, items, requests });
      if (result) return result;
    }
    if (url.endsWith('cart/update.js')) items = items.filter((item) => body.updates[item.key] !== 0);
    if (url.endsWith('cart/add.js'))
      items.push(
        ...body.items.map((item, i) => ({
          key: `${item.id}:new-${i}`,
          variant_id: Number(item.id),
          quantity: item.quantity,
          properties: item.properties,
        })),
      );
    return Response.json({ items, currency: 'EUR' });
  };
  return { fetchImpl, requests };
}
test('replaces only v2 members by current key and applies exact real-variant vector on locale root', async () => {
  const remote = provider();
  const cart = createAjaxCartAdapter({ root: '/nl/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(
    result.cart.ordinary.map((item) => item.quantity),
    [3],
  );
  assert.deepEqual(
    remote.requests.filter((r) => r.method === 'POST'),
    [
      { url: '/nl/cart/update.js', method: 'POST', body: { updates: { '42:old-member': 0 } } },
      {
        url: '/nl/cart/add.js',
        method: 'POST',
        body: { items: [{ id: '42', quantity: 2, properties: desired[0].properties }] },
      },
    ],
  );
});

test('lost acknowledgement refetches observed effects but never automatically redispatches', async () => {
  const remote = provider([], ({ url, body, items }) => {
    if (url.endsWith('cart/add.js')) {
      items.push({
        key: '42:effect',
        variant_id: 42,
        quantity: body.items[0].quantity,
        properties: body.items[0].properties,
      });
      throw new Error('connection lost after effect');
    }
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, 'mutation_unresolved');
  assert.equal(result.cart.customized.length, 1);
  await cart.apply([{ ...desired[0], quantity: 3 }], { expectedFingerprint: result.cart.fingerprint });
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 1);
});

test('external edits invalidate review before any mutation', async () => {
  let reads = 0;
  const remote = provider([ordinary, old], ({ url, items }) => {
    if (url.endsWith('cart.js') && ++reads === 2) items[0].quantity = 4;
  });
  const cart = createAjaxCartAdapter({ root: '/fr-ca/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.reason, 'cart_changed');
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 0);
});

test('inventory clipping never reports exact application success', async () => {
  const remote = provider([ordinary], ({ url, body, items }) => {
    if (url.endsWith('cart/add.js')) {
      items.push({ key: '42:clipped', variant_id: 42, quantity: 1, properties: body.items[0].properties });
      return Response.json({ items });
    }
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.reason, 'vector_mismatch');
  assert.equal(result.cart.customized[0].quantity, 1);
});

test('ordinary changes between removal and add stop the sequence; malformed v2 markers are repairable', async () => {
  const malformed = { ...old, properties: { _insignia_member_v2: '' } };
  const remote = provider([ordinary, malformed], ({ url, items, requests }) => {
    if (url.endsWith('cart.js') && requests.some((r) => r.url.endsWith('cart/update.js'))) items[0].quantity = 8;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  assert.equal(initial.customized.length, 1);
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.reason, 'cart_changed');
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 1);
  assert.equal(
    remote.requests.some((r) => r.url.endsWith('cart/add.js')),
    false,
  );
});

test('remote roots, unsafe variants, duplicate members and mixed quote sets fail before effects', async () => {
  assert.throws(() => createAjaxCartAdapter({ root: '//evil.example/' }), /locale/);
  assert.throws(() => createAjaxCartAdapter({ root: '/en/?redirect=evil' }), /locale/);
  const remote = provider();
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  await assert.rejects(
    cart.apply([{ ...desired[0], variantId: 9007199254740992 }], { expectedFingerprint: '' }),
    /variant/,
  );
  await assert.rejects(cart.apply([desired[0], desired[0]], { expectedFingerprint: '' }), /vector/);
  await assert.rejects(
    cart.apply(
      [desired[0], { ...desired[0], properties: { _insignia_quote_v2: 'other', _insignia_member_v2: 'other' } }],
      { expectedFingerprint: '' },
    ),
    /vector/,
  );
  assert.equal(remote.requests.length, 0);
});

test('already-applied vector succeeds without duplicate addition and empty vector removes customization only', async () => {
  const line = { ...old, quantity: 2, properties: desired[0].properties };
  const remote = provider([ordinary, line]);
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  assert.equal((await cart.apply(desired, { expectedFingerprint: initial.fingerprint })).status, 'applied');
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 0);
  const removed = await cart.apply([], { expectedFingerprint: initial.fingerprint });
  assert.equal(removed.status, 'applied');
  assert.equal(removed.cart.ordinary.length, 1);
  assert.equal(removed.cart.customized.length, 0);
});

test('oversized accepted properties are rejected before dispatch', async () => {
  const remote = provider();
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const buckets = Array.from({ length: 8 }, (_, i) => ({
    ...desired[0],
    properties: { ...desired[0].properties, _insignia_member_v2: `member-${i}`, Summary: 'x'.repeat(10000) },
  }));
  await assert.rejects(cart.apply(buckets, { expectedFingerprint: '' }), /payload/);
  assert.equal(remote.requests.length, 0);
});

test('uncertain dispatch persists across adapter recreation without storing cart or authorization', async () => {
  let unresolved = false;
  const journal = {
    readUnresolved: () => unresolved,
    writeUnresolved: (value) => {
      unresolved = value;
    },
  };
  const remote = provider([], ({ url }) => {
    if (url.endsWith('cart/add.js')) throw new Error('unknown delivery');
  });
  const first = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const initial = await first.read();
  assert.equal(
    (await first.apply(desired, { expectedFingerprint: initial.fingerprint })).reason,
    'mutation_unresolved',
  );
  assert.equal(unresolved, true);
  const reloaded = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  assert.equal(
    (await reloaded.apply(desired, { expectedFingerprint: initial.fingerprint })).reason,
    'mutation_unresolved',
  );
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 1);
});

test('an unwritable uncertainty journal prevents dispatch; acknowledged application clears the flag', async () => {
  const remote = provider([]);
  const denied = createAjaxCartAdapter({
    root: '/',
    fetchImpl: remote.fetchImpl,
    journal: {
      readUnresolved: () => false,
      writeUnresolved: () => {
        throw new Error('storage denied');
      },
    },
  });
  const initial = await denied.read();
  assert.equal((await denied.apply(desired, { expectedFingerprint: initial.fingerprint })).status, 'review_required');
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 0);
  const journalWrites = [];
  const acknowledged = createAjaxCartAdapter({
    root: '/',
    fetchImpl: remote.fetchImpl,
    journal: { readUnresolved: () => false, writeUnresolved: (value) => journalWrites.push(value) },
  });
  assert.equal((await acknowledged.apply(desired, { expectedFingerprint: initial.fingerprint })).status, 'applied');
  assert.deepEqual(journalWrites, [true, false]);
});

test('real HTTP lost-response reconciliation observes effect and persists the no-redispatch latch', async () => {
  const { createServer } = await import('node:http');
  const items = [];
  let writes = 0;
  let unresolved = false;
  const server = createServer(async (request, response) => {
    if (request.url === '/nl/cart/add.js') {
      let text = '';
      for await (const chunk of request) text += chunk;
      const added = JSON.parse(text).items[0];
      items.push({
        key: '42:http-effect',
        variant_id: added.id,
        quantity: added.quantity,
        properties: added.properties,
      });
      writes++;
      response.destroy();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ items, currency: 'EUR' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const cart = createAjaxCartAdapter({
      root: '/nl/',
      fetchImpl: (path, init) => fetch(base + path, init),
      journal: {
        readUnresolved: () => unresolved,
        writeUnresolved: (value) => {
          unresolved = value;
        },
      },
    });
    const initial = await cart.read();
    const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
    assert.equal(result.reason, 'mutation_unresolved');
    assert.equal(result.cart.customized[0].quantity, 2);
    assert.equal(unresolved, true);
    await cart.apply(desired, { expectedFingerprint: result.cart.fingerprint });
    assert.equal(writes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ordinary scalar properties remain exact rather than coercing or rejecting valid cart metadata', async () => {
  const scalars = { Gift: true, Copies: 2, Note: null, Text: 'true' };
  const remote = provider([{ ...ordinary, properties: scalars }, old]);
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  assert.deepEqual(initial.ordinary[0].properties, scalars);
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.cart.ordinary[0].properties, scalars);
});

test('independent same-page adapters cannot overlap cart application across locale roots', async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let hold = false;
  const remote = provider([], async ({ url }) => {
    if (hold && url.endsWith('cart.js')) {
      hold = false;
      entered();
      await gate;
    }
  });
  const first = createAjaxCartAdapter({ root: '/nl/', fetchImpl: remote.fetchImpl });
  const second = createAjaxCartAdapter({ root: '/en/', fetchImpl: remote.fetchImpl });
  const initial = await first.read();
  hold = true;
  const pending = first.apply(desired, { expectedFingerprint: initial.fingerprint });
  await started;
  try {
    const concurrent = await second.apply(desired, { expectedFingerprint: initial.fingerprint });
    assert.equal(concurrent.reason, 'busy');
    assert.equal(remote.requests.filter((request) => request.method === 'POST').length, 0);
  } finally {
    release();
  }
  assert.equal((await pending).status, 'applied');
  const after = await second.read();
  assert.equal((await second.apply(desired, { expectedFingerprint: after.fingerprint })).status, 'applied');
});

test('application releases the shared lock after read failure and accepts a pure injected nonwaiting lock', async () => {
  let failures = 0;
  const remote = provider([], ({ url }) => {
    if (url.endsWith('cart.js') && failures-- > 0) throw new Error('read unavailable');
  });
  const first = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await first.read();
  failures = 2;
  assert.equal((await first.apply(desired, { expectedFingerprint: initial.fingerprint })).reason, 'cart_unavailable');
  const second = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  assert.equal((await second.apply(desired, { expectedFingerprint: initial.fingerprint })).status, 'applied');
  const denied = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, lock: { run: async () => null } });
  const count = remote.requests.length;
  assert.equal((await denied.apply(desired, { expectedFingerprint: initial.fingerprint })).reason, 'busy');
  assert.equal(remote.requests.length, count);
});

test('actual browser origin lock excludes application from a second tab across locale roots', {
  timeout: 15000,
}, async () => {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  let browser;
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let blocked = false;
  let items = [];
  let writes = 0;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await context.route('**/cart.js', async (route) => {
      if (blocked && route.request().frame().page() === first) {
        blocked = false;
        entered();
        await gate;
      }
      await route.fulfill({ json: { items, currency: 'EUR' } });
    });
    await context.route('**/cart/add.js', async (route) => {
      const added = route.request().postDataJSON().items[0];
      writes++;
      items = [{ key: '42:browser', variant_id: added.id, quantity: added.quantity, properties: added.properties }];
      await route.fulfill({ json: { items } });
    });
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    await Promise.all([first.goto(base), second.goto(base)]);
    const fingerprint = await first.evaluate(async () => {
      const { createAjaxCartAdapter } = await import('/src/cart.ts');
      window.testCart = createAjaxCartAdapter({ root: '/nl/' });
      return (await window.testCart.read()).fingerprint;
    });
    await second.evaluate(async () => {
      const { createAjaxCartAdapter } = await import('/src/cart.ts');
      window.testCart = createAjaxCartAdapter({ root: '/en/' });
    });
    assert.equal(await first.evaluate(() => !!navigator.locks), true);
    blocked = true;
    const applying = first.evaluate(
      ({ buckets, fingerprint }) => window.testCart.apply(buckets, { expectedFingerprint: fingerprint }),
      { buckets: desired, fingerprint },
    );
    await started;
    try {
      const concurrent = await second.evaluate(
        ({ buckets, fingerprint }) => window.testCart.apply(buckets, { expectedFingerprint: fingerprint }),
        { buckets: desired, fingerprint },
      );
      assert.equal(concurrent.reason, 'busy');
      assert.equal(writes, 0);
    } finally {
      release();
    }
    assert.equal((await applying).status, 'applied');
    assert.equal(writes, 1);
    const later = await second.evaluate(async (buckets) => {
      const observed = await window.testCart.read();
      return window.testCart.apply(buckets, { expectedFingerprint: observed.fingerprint });
    }, desired);
    assert.equal(later.status, 'applied');
    assert.equal(writes, 1);
  } finally {
    release?.();
    await browser?.close();
    await server.close();
  }
});

test('the accepted vector is captured before asynchronous browser lock acquisition', async () => {
  let enter;
  let release;
  const started = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const remote = provider([]);
  const cart = createAjaxCartAdapter({
    root: '/',
    fetchImpl: remote.fetchImpl,
    lock: {
      run: async (action) => {
        enter();
        await gate;
        return action();
      },
    },
  });
  const initial = await cart.read();
  const buckets = structuredClone(desired);
  const applying = cart.apply(buckets, { expectedFingerprint: initial.fingerprint });
  await started;
  buckets[0].quantity = 99;
  buckets[0].properties._insignia_quote_v2 = 'changed-after-review';
  release();
  const result = await applying;
  assert.equal(result.cart.customized[0].quantity, 2);
  assert.equal(result.cart.customized[0].properties._insignia_quote_v2, 'new');
});
