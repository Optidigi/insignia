import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CartBucket, CartMutationIntent } from '../src/cart.ts';
import { createAjaxCartAdapter } from '../src/cart.ts';
import { type AjaxItem, ajaxBody, fetchBody, lineCarriers, requestUrl, required, serverPort } from './support.mts';

/** Replaces the final character with a different one, so the tamper can never be a no-op. */
function alterLastChar(value: string): string {
  const altered = `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;
  assert.notEqual(altered, value);
  return altered;
}

const LINE = '_insignia_line_v3';
const signed = lineCarriers([
  { variantId: '42', unitMinor: '3033' },
  { variantId: '42', unitMinor: '3034' },
]);
const fresh = lineCarriers([{ variantId: '42', unitMinor: '3033' }], { set: 2 });
const carrier = required(signed.carriers[0]);
const ordinary = { key: '42:ordinary', variant_id: 42, quantity: 3, properties: { Gift: 'Yes' } };
/** A leftover historical v2 line: still owned, so an apply replaces it. */
const old = {
  key: '42:old-member',
  variant_id: 42,
  quantity: 1,
  properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'old-member' },
};
const desired: [CartBucket] = [
  {
    variantId: 'gid://shopify/ProductVariant/42',
    quantity: 2,
    properties: { [LINE]: carrier },
  },
];
const freshDesired = (): CartBucket[] => [
  { ...required(desired[0]), properties: { [LINE]: required(fresh.carriers[0]) } },
];
type ProviderCall = { url: string; method: string; body?: ReturnType<typeof fetchBody> };
function provider(
  initial: AjaxItem[] = [ordinary, old],
  hook?: (
    input: Omit<ProviderCall, 'body'> & {
      body: ReturnType<typeof fetchBody>;
      items: AjaxItem[];
      attributes: Record<string, string>;
      requests: ProviderCall[];
    },
  ) => Response | undefined | Promise<Response | undefined>,
  initialAttributes: Record<string, string> = {},
) {
  let items = structuredClone(initial);
  const attributes = structuredClone(initialAttributes);
  const requests: ProviderCall[] = [];
  let added = 0; // Shopify line keys stay unique across adds
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const body = fetchBody(init);
    requests.push({ url, method: init.method ?? 'GET', body: init.body ? body : undefined });
    if (hook) {
      const result = await hook({ url, method: init.method ?? 'GET', body, items, attributes, requests });
      if (result) return result;
    }
    if (url.endsWith('cart/update.js')) {
      // Like Shopify: a positive quantity resizes the line by key, zero removes it.
      if (body.updates)
        items = items
          .map((item) => {
            const quantity = body.updates?.[item.key];
            return quantity === undefined ? item : { ...item, quantity };
          })
          .filter((item) => item.quantity !== 0);
      if (body.attributes) Object.assign(attributes, body.attributes);
    }
    if (url.endsWith('cart/add.js'))
      items.push(
        ...required(body.items).map((item) => ({
          key: `${item.id}:new-${added++}`,
          variant_id: Number(item.id),
          quantity: item.quantity,
          properties: item.properties,
        })),
      );
    return Response.json({ items, attributes, currency: 'EUR' });
  };
  return {
    fetchImpl,
    requests,
    get items() {
      return items;
    },
  };
}
test('replaces owned lines by current key and applies the exact v3 vector with no cart attribute write', async () => {
  const remote = provider();
  const cart = createAjaxCartAdapter({ root: '/nl/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(
    required(result.cart).ordinary.map((item) => item.quantity),
    [3],
  );
  assert.deepEqual(
    remote.requests.filter((r) => r.method === 'POST'),
    [
      {
        url: '/nl/cart/add.js',
        method: 'POST',
        body: { items: [{ id: '42', quantity: 2, properties: required(desired[0]).properties }] },
      },
      {
        url: '/nl/cart/update.js',
        method: 'POST',
        body: { updates: { '42:old-member': 0 } },
      },
    ],
  );
  // One read before writing and one verifying the added lines before anything is removed; the removal write
  // returns the complete cart and serves as its own witness. Each line carries its own authorization: no
  // attribute write.
  assert.deepEqual(
    remote.requests.slice(1).map((r) => r.url),
    ['/nl/cart.js', '/nl/cart/add.js', '/nl/cart.js', '/nl/cart/update.js'],
  );
});

test('a leftover v2 quote attribute is cleared inside the removal write, never by an extra request', async () => {
  const remote = provider([ordinary], undefined, { _insignia_quote_v2: 'stale', Gift: 'keep' });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(
    remote.requests.filter((r) => r.method === 'POST').map((r) => [r.url, r.body]),
    [
      ['/cart/add.js', { items: [{ id: '42', quantity: 2, properties: { [LINE]: carrier } }] }],
      ['/cart/update.js', { updates: {}, attributes: { _insignia_quote_v2: '' } }],
    ],
  );
  assert.deepEqual(required(result.cart).attributes, { Gift: 'keep' });
});

test('lost acknowledgement refetches observed effects but never automatically redispatches', async () => {
  const remote = provider([], ({ url, body, items }) => {
    if (url.endsWith('cart/add.js')) {
      items.push({
        key: '42:effect',
        variant_id: 42,
        // A partial effect: a complete one is the goal and reconciles as applied (see lost add acknowledgement).
        quantity: required(required(body.items)[0]).quantity - 1,
        properties: required(required(body.items)[0]).properties,
      });
      throw new Error('connection lost after effect');
    }
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, 'mutation_unresolved');
  assert.equal(required(result.cart).customized.length, 1);
  await cart.apply([{ ...required(desired[0]), quantity: 3 }], {
    expectedFingerprint: required(result.cart).fingerprint,
  });
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 1);
});

test('external edits invalidate review before any mutation', async () => {
  let reads = 0;
  const remote = provider([ordinary, old], ({ url, items }) => {
    if (url.endsWith('cart.js') && ++reads === 2) required(items[0]).quantity = 4;
    return undefined;
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
      items.push({
        key: '42:clipped',
        variant_id: 42,
        quantity: 1,
        properties: required(required(body.items)[0]).properties,
      });
      return Response.json({ items });
    }
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.reason, 'vector_mismatch');
  assert.equal(required(required(result.cart).customized[0]).quantity, 1);
});

test('ordinary changes during the removal report a changed cart; malformed v2 markers are repairable', async () => {
  const malformed = { ...old, properties: { _insignia_member_v2: '' } };
  // The removal write's own complete-cart response is the witness.
  const remote = provider([ordinary, malformed], ({ url, items }) => {
    if (url.endsWith('cart/update.js')) required(items[0]).quantity = 8;
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  assert.equal(initial.customized.length, 1);
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.reason, 'cart_changed');
  assert.deepEqual(
    remote.requests.filter((r) => r.method === 'POST').map((r) => r.url),
    ['/cart/add.js', '/cart/update.js'],
  );
  assert.deepEqual(
    required(result.cart).customized.map((line) => line.properties[LINE]),
    [carrier],
  );
});

test('remote roots, unsafe variants, duplicate carriers, mixed sets and extra properties fail before effects', async () => {
  assert.throws(() => createAjaxCartAdapter({ root: '//evil.example/' }), /locale/);
  assert.throws(() => createAjaxCartAdapter({ root: '/en/?redirect=evil' }), /locale/);
  const remote = provider();
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  await assert.rejects(
    // @ts-expect-error Deliberately reject unsafe numeric variant input at the runtime boundary.
    cart.apply([{ ...required(desired[0]), variantId: 9007199254740992 }], { expectedFingerprint: '' }),
    /variant/,
  );
  await assert.rejects(cart.apply([required(desired[0]), required(desired[0])], { expectedFingerprint: '' }), /vector/);
  await assert.rejects(
    cart.apply(
      [required(desired[0]), { ...required(desired[0]), properties: { [LINE]: required(fresh.carriers[0]) } }],
      { expectedFingerprint: '' },
    ),
    /vector/,
  );
  // Two lines of one set differ only after the shared 236-character prefix.
  assert.equal(required(signed.carriers[1]).slice(0, 236), carrier.slice(0, 236));
  const invalid: Record<string, string>[] = [
    { [LINE]: carrier, _insignia_member_v2: 'member-0' },
    { [LINE]: carrier, Summary: 'x' },
    { [LINE]: signed.prefix },
    { _insignia_quote_v2: 'new', _insignia_member_v2: 'member-0' },
  ];
  for (const properties of invalid)
    await assert.rejects(cart.apply([{ ...required(desired[0]), properties }], { expectedFingerprint: '' }), /vector/);
  assert.equal(remote.requests.length, 0);
});

test('already-applied vector succeeds without duplicate addition and empty vector removes customization only', async () => {
  const line = { ...old, quantity: 2, properties: required(desired[0]).properties };
  const remote = provider([ordinary, line]);
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  assert.equal((await cart.apply(desired, { expectedFingerprint: initial.fingerprint })).status, 'applied');
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 0);
  const removed = await cart.apply([], { expectedFingerprint: initial.fingerprint });
  assert.equal(removed.status, 'applied');
  assert.equal(required(removed.cart).ordinary.length, 1);
  assert.equal(required(removed.cart).customized.length, 0);
});

test('oversized vectors are rejected before dispatch', async () => {
  const remote = provider();
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const many = lineCarriers(Array.from({ length: 32 }, (_, i) => ({ variantId: String(42 + i), unitMinor: '1' })));
  const bucket = (index: number) => ({
    variantId: String(42 + index),
    quantity: 1,
    properties: { [LINE]: required(many.carriers[index]) },
  });
  const buckets = many.carriers.map((_, i) => bucket(i));
  const extra = { ...bucket(0), properties: { [LINE]: alterLastChar(required(many.carriers[0])) } };
  await assert.rejects(cart.apply([...buckets, extra], { expectedFingerprint: '' }), /vector/);
  await assert.rejects(
    cart.apply(
      [
        { ...bucket(0), quantity: 6000 },
        { ...bucket(1), quantity: 4001 },
      ],
      { expectedFingerprint: '' },
    ),
    /vector/,
  );
  await assert.rejects(cart.apply([{ ...bucket(0), quantity: 10001 }], { expectedFingerprint: '' }), /vector/);
  await assert.rejects(
    cart.apply([{ ...bucket(0), properties: { [LINE]: `${carrier}${'A'.repeat(70000)}` } }], {
      expectedFingerprint: '',
    }),
    /payload|properties/,
  );
  assert.equal(remote.requests.length, 0);
});

test('uncertain dispatch persists across adapter recreation without storing cart or authorization', async () => {
  let unresolved = false;
  const journal = {
    readUnresolved: () => unresolved,
    writeUnresolved: (value: boolean) => {
      unresolved = value;
    },
  };
  const remote = provider([], ({ url }) => {
    if (url.endsWith('cart/add.js')) throw new Error('unknown delivery');
    return undefined;
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
  const journalWrites: boolean[] = [];
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
  const items: AjaxItem[] = [];
  let writes = 0;
  let unresolved = false;
  const server = createServer(async (request, response) => {
    if (request.url === '/nl/cart/add.js') {
      let text = '';
      for await (const chunk of request) text += chunk;
      const added = required(required(ajaxBody(JSON.parse(text)).items)[0]);
      items.push({
        key: '42:http-effect',
        variant_id: added.id,
        // Partial effect (inventory-clipped) with a lost response: observable, never the goal.
        quantity: added.quantity - 1,
        properties: added.properties,
      });
      writes++;
      response.destroy();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ items, currency: 'EUR' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  try {
    const base = `http://127.0.0.1:${serverPort(server)}`;
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
    assert.equal(required(required(result.cart).customized[0]).quantity, 1);
    assert.equal(unresolved, true);
    await cart.apply(desired, { expectedFingerprint: required(result.cart).fingerprint });
    assert.equal(writes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('ordinary scalar properties remain exact rather than coercing or rejecting valid cart metadata', async () => {
  const scalars = { Gift: true, Copies: 2, Note: null, Text: 'true' };
  const remote = provider([{ ...ordinary, properties: scalars }, old]);
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const initial = await cart.read();
  assert.deepEqual(required(initial.ordinary[0]).properties, scalars);
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(required(required(result.cart).ordinary[0]).properties, scalars);
});

test('independent same-page adapters cannot overlap cart application across locale roots', async () => {
  let release: () => void = () => {
    throw new Error('Missing release gate');
  };
  let entered: () => void = () => {
    throw new Error('Missing entered gate');
  };
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = false;
  const remote = provider([], async ({ url }) => {
    if (hold && url.endsWith('cart.js')) {
      hold = false;
      entered();
      await gate;
    }
    return undefined;
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
    return undefined;
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
  const { createStorefrontTestServer: createServer } = await import('./support.mts');
  const { chromium } = await import('playwright');
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let release: () => void = () => {
    throw new Error('Missing release gate');
  };
  let entered: () => void = () => {
    throw new Error('Missing entered gate');
  };
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  let items: AjaxItem[] = [];
  const attributes: Record<string, string> = {};
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
      await route.fulfill({ json: { items, attributes, currency: 'EUR' } });
    });
    await context.route('**/cart/add.js', async (route) => {
      const added = required(required(ajaxBody(route.request().postDataJSON()).items)[0]);
      writes++;
      items = [{ key: '42:browser', variant_id: added.id, quantity: added.quantity, properties: added.properties }];
      await route.fulfill({ json: { items } });
    });
    await context.route('**/cart/update.js', async (route) => {
      const body = ajaxBody(route.request().postDataJSON());
      if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
      Object.assign(attributes, body.attributes ?? {});
      await route.fulfill({ json: { items, attributes, currency: 'EUR' } });
    });
    const base = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    await Promise.all([first.goto(base), second.goto(base)]);
    const fingerprint = await first.evaluate(async () => {
      // @ts-expect-error Vite serves the actual typed module at its browser HTTP path.
      const { createAjaxCartAdapter }: typeof import('../src/cart.ts') = await import('/src/cart.ts');
      window.testCart = createAjaxCartAdapter({ root: '/nl/' });
      return (await window.testCart.read()).fingerprint;
    });
    await second.evaluate(async () => {
      // @ts-expect-error Vite serves the actual typed module at its browser HTTP path.
      const { createAjaxCartAdapter }: typeof import('../src/cart.ts') = await import('/src/cart.ts');
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
  let enter: () => void = () => {
    throw new Error('Missing enter gate');
  };
  let release: () => void = () => {
    throw new Error('Missing release gate');
  };
  const started = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
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
  required(buckets[0]).quantity = 99;
  required(buckets[0]).properties[LINE] = required(fresh.carriers[0]);
  release();
  const result = await applying;
  assert.equal(required(required(result.cart).customized[0]).quantity, 2);
  assert.equal(required(required(result.cart).customized[0]).properties[LINE], carrier);
});

test('accepted vector keeps each line carrier and writes no cart-level quote attribute', async () => {
  const remote = provider([ordinary]);
  const adapter = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const before = await adapter.read();
  const result = await adapter.apply(desired, { expectedFingerprint: before.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(required(result.cart).attributes, {});
  assert.deepEqual(required(required(result.cart).customized[0]).properties, { [LINE]: carrier });
  assert.deepEqual(
    remote.requests.filter((r) => r.method === 'POST').map((r) => r.url),
    ['/cart/add.js'],
  );
});

test('an Add into a cart without customization is one read, one add and one witness read', async () => {
  const remote = provider([ordinary]);
  const adapter = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const before = await adapter.read();
  const count = remote.requests.length;
  const result = await adapter.apply(desired, { expectedFingerprint: before.fingerprint });
  assert.equal(result.status, 'applied');
  assert.deepEqual(
    remote.requests.slice(count).map((r) => r.url),
    ['/cart.js', '/cart/add.js', '/cart.js'],
  );
  assert.deepEqual(required(result.cart).ordinary[0]?.properties, ordinary.properties);
});

for (const drift of ['currency', 'ordinary', 'foreign attribute', 'line'] as const) {
  test(`a witness read with a changed ${drift} is a mismatch; the acknowledged add is never repeated`, async () => {
    let pending = false;
    const remote = provider([ordinary], ({ url, items, attributes, requests }) => {
      if (!url.endsWith('cart.js') || !requests.some((r) => r.url.endsWith('cart/add.js'))) return undefined;
      if (drift === 'ordinary') required(items[0]).quantity++;
      if (drift === 'foreign attribute') attributes.Gift = 'Changed';
      if (drift === 'line') required(items.find((item) => item.properties[LINE])).quantity++;
      return Response.json({ items, attributes, currency: drift === 'currency' ? 'USD' : 'EUR' });
    });
    const adapter = createAjaxCartAdapter({
      root: '/',
      fetchImpl: remote.fetchImpl,
      journal: {
        readUnresolved: () => pending,
        writeUnresolved: (value) => {
          pending = value;
        },
      },
    });
    const before = await adapter.read();
    const result = await adapter.apply(desired, { expectedFingerprint: before.fingerprint });
    assert.equal(result.status, 'review_required');
    assert.equal(result.reason, 'vector_mismatch');
    assert.equal(pending, false, 'every write was acknowledged: nothing is left in flight');
    const adds = remote.requests.filter((r) => r.url.endsWith('cart/add.js')).length;
    await adapter.apply(desired, { expectedFingerprint: required(result.cart).fingerprint });
    assert.equal(remote.requests.filter((r) => r.url.endsWith('cart/add.js')).length, adds);
  });
}

test('malformed witness read reconciles the actual effect without redispatch', async () => {
  let malformed = true;
  const remote = provider([ordinary], ({ url, requests }) => {
    if (!malformed || !url.endsWith('cart.js') || !requests.some((r) => r.url.endsWith('cart/add.js')))
      return undefined;
    malformed = false;
    return Response.json({ items: 'not a complete cart' });
  });
  const adapter = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const before = await adapter.read();
  const result = await adapter.apply(desired, { expectedFingerprint: before.fingerprint });
  assert.equal(result.status, 'applied');
  assert.equal(required(required(result.cart).customized[0]).properties[LINE], carrier);
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 1);
  assert.equal(remote.requests.filter((r) => r.url.endsWith('cart.js')).length, 4);
});

test('lost add acknowledgement settles the exact full goal after reload without another mutation', async () => {
  let state: CartMutationIntent | null = null,
    flag = false;
  const journal = {
    readUnresolved: () => flag,
    writeUnresolved: (v: boolean) => {
      flag = v;
    },
    readIntent: () => state,
    writeIntent: (v: CartMutationIntent | null) => {
      state = structuredClone(v);
    },
  };
  let lose = true;
  const remote = provider([ordinary], ({ url, body, items }) => {
    if (lose && url.endsWith('cart/add.js')) {
      const added = required(required(body.items)[0]);
      items.push({ key: '42:lost', variant_id: 42, quantity: added.quantity, properties: added.properties });
      lose = false;
      throw new Error('response lost after effect');
    }
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const initial = await cart.read();
  const result = await cart.apply(desired, { expectedFingerprint: initial.fingerprint });
  assert.equal(result.status, 'applied');
  const writes = remote.requests.filter((r) => r.method === 'POST').length;
  const reloaded = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  assert.equal(
    (await reloaded.apply(desired, { expectedFingerprint: required(result.cart).fingerprint })).status,
    'applied',
  );
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, writes);
  assert.equal(flag, false);
});

test('partial unknown delivery permits explicit observed removal, retains tombstone and rejects late effects or old replay', async () => {
  let state: CartMutationIntent | null = null,
    flag = false,
    late: (() => void) | undefined;
  const journal = {
    readUnresolved: () => flag,
    writeUnresolved: (v: boolean) => {
      flag = v;
    },
    readIntent: () => state,
    writeIntent: (v: CartMutationIntent | null) => {
      state = structuredClone(v);
    },
  };
  const remote = provider([ordinary], ({ url, body, items }) => {
    if (url.endsWith('cart/add.js') && !late) {
      late = () =>
        remote.items.push({
          key: '42:late',
          variant_id: 42,
          quantity: required(required(body.items)[0]).quantity,
          properties: required(required(body.items)[0]).properties,
        });
      items.push({
        key: '42:partial',
        variant_id: 42,
        quantity: 1,
        properties: required(required(body.items)[0]).properties,
      });
      throw new Error('unknown partial delivery');
    }
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const before = await cart.read();
  assert.equal((await cart.apply(desired, { expectedFingerprint: before.fingerprint })).reason, 'mutation_unresolved');
  const observed = await cart.read();
  const remove = await cart.apply([], { expectedFingerprint: observed.fingerprint, repair: true });
  assert.equal(remove.status, 'applied');
  assert.equal(remove.recovery, 'late_effects_possible');
  assert.equal(required(remove.cart).customized.length, 0);
  assert.equal(required(required(remove.cart).ordinary[0]).quantity, 3);
  assert.equal(required<CartMutationIntent>(state).phase, 'abandoned');
  assert.equal(flag, true);
  assert.ok(!JSON.stringify(state).includes(carrier.slice(0, 236)));
  assert.ok(!JSON.stringify(state).includes('Gift'));
  const count = remote.requests.filter((r) => r.method === 'POST').length;
  const reloaded = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  assert.equal(
    (await reloaded.apply(desired, { expectedFingerprint: required(remove.cart).fingerprint })).reason,
    'mutation_unresolved',
  );
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, count);
  // A late unknown add is visible and cannot be silently retried or hidden by a journal reset.
  required(late)();
  const after = await reloaded.read();
  assert.equal((await reloaded.reconcile()).status, 'review_required');
  assert.equal(
    (
      await reloaded.apply(freshDesired(), {
        expectedFingerprint: after.fingerprint,
      })
    ).reason,
    'mutation_unresolved',
  );
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, count);
});

test('restart can read-reconcile a witnessed complete goal after both acknowledgement and first observation were lost', async () => {
  let state: CartMutationIntent | null = null,
    flag = false,
    failRead = false;
  const journal = {
    readUnresolved: () => flag,
    writeUnresolved: (v: boolean) => {
      flag = v;
    },
    readIntent: () => state,
    writeIntent: (v: CartMutationIntent | null) => {
      state = structuredClone(v);
    },
  };
  const remote = provider([ordinary], ({ url, body, items }) => {
    if (url.endsWith('cart/add.js')) {
      const added = required(required(body.items)[0]);
      items.push({ key: '42:lost', variant_id: 42, quantity: added.quantity, properties: added.properties });
      failRead = true;
      throw new Error('lost acknowledgement');
    }
    if (url.endsWith('cart.js') && failRead) {
      failRead = false;
      throw new Error('observation unavailable');
    }
    return undefined;
  });
  const first = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const before = await first.read();
  assert.equal((await first.apply(desired, { expectedFingerprint: before.fingerprint })).reason, 'mutation_unresolved');
  const writes = remote.requests.filter((r) => r.method === 'POST').length;
  const reload = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  assert.equal((await reload.reconcile()).status, 'applied');
  assert.equal(flag, false);
  assert.equal(state, null);
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, writes);
});

test('unchanged before-state is not delivery proof; explicit removal permits fresh review while retaining old uncertainty', async () => {
  let state: CartMutationIntent | null = null,
    flag = false,
    failAdd = true;
  const journal = {
    readUnresolved: () => flag,
    writeUnresolved: (v: boolean) => {
      flag = v;
    },
    readIntent: () => state,
    writeIntent: (v: CartMutationIntent | null) => {
      state = structuredClone(v);
    },
  };
  const remote = provider([ordinary], ({ url }) => {
    if (failAdd && url.endsWith('cart/add.js')) throw new Error('dispatch outcome unknown');
    return undefined;
  });
  const first = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const before = await first.read();
  assert.equal((await first.apply(desired, { expectedFingerprint: before.fingerprint })).reason, 'mutation_unresolved');
  assert.equal((await first.reconcile()).reason, 'mutation_unresolved');
  assert.equal(remote.requests.filter((r) => r.method === 'POST').length, 1);
  const remove = await first.apply([], { expectedFingerprint: before.fingerprint, repair: true });
  assert.equal(remove.status, 'applied');
  assert.equal(remove.recovery, 'late_effects_possible');
  failAdd = false;
  const applied = await first.apply(freshDesired(), { expectedFingerprint: required(remove.cart).fingerprint });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.recovery, 'late_effects_possible');
  assert.equal(required<CartMutationIntent>(state).phase, 'abandoned');
  assert.equal(required<CartMutationIntent>(state).abandoned.length, 1);
});

test('foreign attributes, a foreign quote attribute or currency changing during application prevent success', async () => {
  for (const changed of ['attributes', 'currency', 'carrier']) {
    const remote = provider(
      [ordinary],
      ({ url, attributes, items, requests }) => {
        if (url.endsWith('cart.js') && requests.some((r) => r.url.endsWith('cart/add.js'))) {
          if (changed === 'attributes') attributes.GiftMessage = 'foreign edit';
          else if (changed === 'carrier') attributes._insignia_quote_v2 = 'foreign-carrier';
          else return Response.json({ items, attributes, currency: 'USD' });
        }
        return undefined;
      },
      { GiftMessage: 'keep' },
    );
    const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
    const before = await cart.read();
    assert.equal((await cart.apply(desired, { expectedFingerprint: before.fingerprint })).reason, 'vector_mismatch');
    assert.equal(
      remote.requests.some((r) => r.body?.attributes !== undefined),
      false,
    );
    assert.equal(required(remote.items[0]).quantity, 3);
  }
});

test('legacy boolean-only uncertainty survives observed removal and restart without permitting new dispatch', async () => {
  for (const initial of [[ordinary], [ordinary, old]]) {
    let unresolved = true;
    let state: CartMutationIntent | null = null;
    const journal = {
      readUnresolved: () => unresolved,
      writeUnresolved: (value: boolean) => {
        unresolved = value;
      },
      readIntent: () => state,
      writeIntent: (value: CartMutationIntent | null) => {
        state = value;
      },
    };
    const remote = provider(initial);
    const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
    const before = await cart.read();
    const removal = await cart.apply([], { expectedFingerprint: before.fingerprint, repair: true });
    assert.equal(removal.status, 'applied');
    assert.equal(removal.recovery, 'late_effects_possible');
    assert.equal(required<CartMutationIntent>(state).phase, 'abandoned');
    assert.equal(unresolved, true);
    const reloaded = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
    const removed = await reloaded.read();
    const posts = remote.requests.filter((r) => r.method === 'POST').length;
    assert.equal(
      (await reloaded.apply(desired, { expectedFingerprint: removed.fingerprint })).reason,
      'mutation_unresolved',
    );
    assert.equal(remote.requests.filter((r) => r.method === 'POST').length, posts);
    assert.deepEqual(remote.items, [ordinary]);
  }
});

/** An in-memory journal shaped like the sessionStorage one (buyer.ts cartJournal). */
function memoryJournal() {
  const journal = {
    state: null as CartMutationIntent | null,
    flag: false,
    readUnresolved: () => journal.flag,
    writeUnresolved: (value: boolean) => {
      journal.flag = value;
    },
    readIntent: () => journal.state,
    writeIntent: (value: CartMutationIntent | null) => {
      journal.state = structuredClone(value);
    },
  };
  return journal;
}
/** A customized line of the first signed set, already in the buyer's cart. */
const existing = { key: '42:existing', variant_id: 42, quantity: 2, properties: { [LINE]: carrier } };
const posts = (requests: ProviderCall[]) =>
  requests.filter((r) => r.method === 'POST').map((r) => [r.url, r.body] as const);

test('a refused add keeps the existing customized lines and does not block a later apply (#339)', async () => {
  let refuse = true;
  const journal = memoryJournal();
  const remote = provider([ordinary, existing], ({ url }) => {
    if (refuse && url.endsWith('cart/add.js'))
      return Response.json({ status: 422, message: 'Cart Error', description: 'Not enough stock' }, { status: 422 });
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const before = await cart.read();
  const seven = [{ ...required(freshDesired()[0]), quantity: 7 }];
  const refused = await cart.apply(seven, { expectedFingerprint: before.fingerprint });
  assert.equal(refused.status, 'review_required');
  assert.equal(refused.reason, 'rejected');
  assert.deepEqual(remote.items, [ordinary, existing], 'the buyer keeps the lines they already had');
  assert.equal(journal.state, null, 'a definite refusal leaves no pending intent');
  assert.equal(journal.flag, false);
  refuse = false;
  const retried = await cart.apply(seven, { expectedFingerprint: required(refused.cart).fingerprint });
  assert.equal(retried.status, 'applied');
  assert.deepEqual(
    required(retried.cart).customized.map((line) => [line.quantity, line.properties[LINE]]),
    [[7, required(fresh.carriers[0])]],
  );
});

test('an add interrupted by navigation leaves the existing customized lines in place (#339)', async () => {
  const journal = memoryJournal();
  const remote = provider([ordinary, existing], ({ url }) => {
    if (url.endsWith('cart/add.js')) throw new DOMException('The user aborted a request.', 'AbortError');
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const before = await cart.read();
  const result = await cart.apply(freshDesired(), { expectedFingerprint: before.fingerprint });
  assert.equal(result.reason, 'mutation_unresolved');
  assert.deepEqual(remote.items, [ordinary, existing]);
  assert.deepEqual(
    posts(remote.requests).map(([url]) => url),
    ['/cart/add.js'],
    'nothing is removed before its replacement exists',
  );
  assert.equal(journal.state?.phase, 'pending', 'an unknown outcome stays recorded');
});

test('replacement adds the new set before removing the old one; an unchanged carrier keeps its line', async () => {
  const remote = provider([ordinary, existing]);
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl });
  const before = await cart.read();
  const replaced = await cart.apply(freshDesired(), { expectedFingerprint: before.fingerprint });
  assert.equal(replaced.status, 'applied');
  assert.deepEqual(posts(remote.requests), [
    ['/cart/add.js', { items: [{ id: '42', quantity: 2, properties: { [LINE]: required(fresh.carriers[0]) } }] }],
    ['/cart/update.js', { updates: { '42:existing': 0 } }],
  ]);
  const line = required(required(replaced.cart).customized[0]);
  remote.requests.length = 0;
  // The same signed line at another quantity: Shopify would merge a second add into the line, so only the
  // quantity changes and the line keeps its key.
  const resized = await cart.apply([{ ...required(freshDesired()[0]), quantity: 5 }], {
    expectedFingerprint: required(replaced.cart).fingerprint,
  });
  assert.equal(resized.status, 'applied');
  assert.deepEqual(posts(remote.requests), [['/cart/update.js', { updates: { [line.key]: 5 } }]]);
  assert.equal(required(required(resized.cart).customized[0]).key, line.key);
});

test('a cart change during the removal step settles the acknowledged writes and does not block a later apply (#338)', async () => {
  const journal = memoryJournal();
  let raced = false;
  const remote = provider([ordinary, existing], ({ url, items }) => {
    if (url.endsWith('cart/update.js') && !raced) {
      raced = true;
      required(items[0]).quantity = 8; // another tab or the theme drawer edits an ordinary line
    }
    return undefined;
  });
  const cart = createAjaxCartAdapter({ root: '/', fetchImpl: remote.fetchImpl, journal });
  const before = await cart.read();
  const result = await cart.apply(freshDesired(), { expectedFingerprint: before.fingerprint });
  assert.equal(result.reason, 'cart_changed');
  assert.deepEqual(
    required(result.cart).customized.map((line) => line.properties[LINE]),
    [required(fresh.carriers[0])],
    'customized lines are never left empty',
  );
  assert.equal(journal.state, null);
  assert.equal(journal.flag, false);
  const later = await cart.apply(desired, { expectedFingerprint: required(result.cart).fingerprint });
  assert.equal(later.status, 'applied');
});

declare global {
  interface Window {
    testCart: ReturnType<typeof createAjaxCartAdapter>;
  }
}
