import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { BuyerConfig } from '../src/buyer.ts';
import { type AjaxItem, fetchBody, lineCarriers, requestUrl } from './support.mts';

/** One-line v3 carrier for a variant; the storefront decodes but never verifies it. */
const v3Carrier = (variantId: string, set = 1) =>
  lineCarriers([{ variantId, unitMinor: '1000' }], { set }).carriers[0] ?? '';

const bundle = await build({
  entryPoints: [new URL('../src/designer/live-ports.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const source = bundle.outputFiles[0];
assert(source);
const temporary = await mkdtemp(join(tmpdir(), 'insignia-live-removal-'));
const moduleFile = join(temporary, 'ports.mjs');
await writeFile(moduleFile, source.text);
after(() => rm(temporary, { recursive: true, force: true }));
const { createLiveDesignerPorts } = (await import(
  pathToFileURL(moduleFile).href
)) as typeof import('../src/designer/live-ports.ts');
const config: BuyerConfig = {
  version: 'm7-config-v1',
  productId: '11',
  revisionId: 'revision',
  contentHash: 'a'.repeat(64),
  methods: [],
  placements: [],
  steps: [],
  options: [],
  variants: [],
  shopCurrency: 'USD',
  geometry: { version: 'm5-geometry-v1', views: [], steps: [] },
  imageUrls: {},
  ready: true,
};
test('lost-session remove-all uses only observed cart and journal, preserves ordinary lines, and writes only after confirmation', async () => {
  const ordinary = { key: 'ordinary', variant_id: 101, quantity: 3, properties: { Gift: 'Yes' } };
  let items: AjaxItem[] = [
    ordinary,
    {
      key: 'custom',
      variant_id: 102,
      quantity: 2,
      properties: { _insignia_line_v3: v3Carrier('102', 1) },
    },
  ];
  const attributes: Record<string, string> = {};
  const writes: string[] = [];
  const allCalls: string[] = [];
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const live = createLiveDesignerPorts({
    source: config,
    productId: '11',
    proxyBase: '/apps/insignia',
    cartRoot: '/',
    country: 'US',
    marketId: '42',
    locale: 'en',
    storeName: 'Store',
    storage,
    fetchImpl: async (url, init = {}) => {
      const path = requestUrl(url);
      allCalls.push(path);
      assert(!path.includes('/apps/'), 'Lost-session removal must not read owned choices or mint a capability');
      if (init.method === 'POST') {
        writes.push(path);
        const body = fetchBody(init);
        if (path.endsWith('/cart/update.js')) {
          if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
          if (body.attributes) Object.assign(attributes, body.attributes);
        }
      }
      return Response.json({ items, attributes, currency: 'USD' });
    },
  });
  const review = await live.prepareRemoval();
  assert.equal(review.totalMinor, '0');
  assert.equal(review.groups.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(items.length, 2);
  // Node's test host supplies only the browser event sink; cart authority is still the actual Ajax adapter.
  const previous = Reflect.get(globalThis, 'window');
  Reflect.set(globalThis, 'window', new EventTarget());
  try {
    await live.confirmRemoval();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Reflect.set(globalThis, 'window', previous);
  }
  assert.deepEqual(items, [ordinary]);
  assert(writes.some((path) => path.endsWith('/cart/update.js')));
  assert(allCalls.every((path) => /^\/cart(?:\.js|\/)/.test(path)));
});

test('removing one design reviews and preserves its sibling and retries identical acceptance before any Ajax write', async () => {
  const group = (intentId: string) => ({
    productId: '11',
    configRevisionId: 'revision',
    revisionContentHash: 'a'.repeat(64),
    design: {
      placements: [
        { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred' as const, intentId } },
      ],
      options: [],
    },
    variants: [{ variantId: '102', quantity: 1 }],
  });
  const removed = group('remove'),
    sibling = group('retain');
  let items: AjaxItem[] = [
    { key: 'ordinary', variant_id: 101, quantity: 3, properties: {} },
    {
      key: 'old-custom',
      variant_id: 102,
      quantity: 2,
      properties: { _insignia_line_v3: v3Carrier('102', 1) },
    },
  ];
  const attributes: Record<string, string> = {};
  const values = new Map<string, string>();
  const acceptBodies: unknown[] = [];
  let quoteCount = 0,
    ajaxWrites = 0;
  let applied: unknown;
  const proposalId = '11111111-1111-4111-8111-111111111111',
    applicationId = '22222222-2222-4222-8222-222222222222';
  const sourceConfig = {
    ...config,
    title: 'Shirt',
    placements: [
      { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
    ],
  };
  const live = createLiveDesignerPorts({
    source: sourceConfig,
    productId: '11',
    proxyBase: '/apps/insignia',
    cartRoot: '/',
    country: 'US',
    marketId: '42',
    locale: 'en',
    storeName: 'Store',
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    onApplied: (groups) => {
      applied = groups;
    },
    fetchImpl: async (url, init = {}) => {
      const path = new URL(requestUrl(url), 'https://fixture.test').pathname,
        body = fetchBody(init);
      if (path.endsWith('/sessions'))
        return Response.json({
          capability: 'abc.def',
          sessionId: applicationId,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      if (path.endsWith('/cart-state')) return Response.json({ groups: [removed, sibling], repairRequired: true });
      if (path.endsWith('/quote-proposals')) {
        quoteCount++;
        const parsed = JSON.parse(String(init.body));
        assert.deepEqual(parsed.groups, [sibling]);
        return Response.json({
          proposalId,
          hash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          currency: 'USD',
          exponent: 2,
          customizedQuantity: 1,
          totalMinor: '1500',
          groups: [
            {
              productId: '11',
              quantity: 1,
              setupMinor: '0',
              customizationUnitMinor: '500',
              baseTotalMinor: '1000',
              totalMinor: '1500',
            },
          ],
          changedGroups: [],
        });
      }
      if (path.endsWith('/accept')) {
        acceptBodies.push(JSON.parse(String(init.body)));
        if (acceptBodies.length === 1) throw new Error('Lost acceptance acknowledgement');
        return Response.json({
          quoteId: proposalId,
          setId: applicationId,
          validThroughDay: 30000,
          applicationId,
          buckets: [
            {
              variantId: '102',
              quantity: 1,
              properties: { _insignia_line_v3: v3Carrier('102', 2) },
            },
          ],
          desired: [sibling],
        });
      }
      if (path.endsWith('/confirm')) return Response.json({ id: applicationId, status: 'APPLIED' });
      if (init.method === 'POST') {
        ajaxWrites++;
        if (path.endsWith('/cart/update.js')) {
          if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
          if (body.attributes) Object.assign(attributes, body.attributes);
        } else if (path.endsWith('/cart/add.js'))
          for (const item of body.items ?? [])
            items.push({
              key: 'new-custom',
              variant_id: item.id,
              quantity: item.quantity,
              properties: item.properties,
            });
      }
      return Response.json({ items, attributes, currency: 'USD' });
    },
  });
  const review = await live.prepareRemoval(removed);
  assert.equal(review.totalMinor, '1500');
  assert.equal(review.groups[0]?.label, 'Shirt');
  assert.equal(ajaxWrites, 0);
  await assert.rejects(live.confirmRemoval, /Lost acceptance/);
  assert.equal(ajaxWrites, 0);
  assert.equal(quoteCount, 1);
  const previous = Reflect.get(globalThis, 'window');
  Reflect.set(globalThis, 'window', new EventTarget());
  try {
    await live.confirmRemoval();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Reflect.set(globalThis, 'window', previous);
  }
  assert.deepEqual(acceptBodies[0], acceptBodies[1]);
  assert.equal(quoteCount, 1);
  assert.deepEqual(applied, [sibling]);
  assert.equal(items.find((item) => item.key === 'ordinary')?.quantity, 3);
  assert.equal(items.find((item) => item.key === 'new-custom')?.quantity, 1);
});

/** Two owned designs in the cart; `removed` is the one the buyer removes. Every request is counted by route. */
function siblingRemoval(cart: { ordinaryLines?: number; siblingQuantity?: number } = {}) {
  const group = (intentId: string, quantity = 1) => ({
    productId: '11',
    configRevisionId: 'revision',
    revisionContentHash: 'a'.repeat(64),
    design: {
      placements: [
        { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred' as const, intentId } },
      ],
      options: [],
    },
    variants: [{ variantId: '102', quantity }],
  });
  const removed = group('remove'),
    sibling = group('retain', cart.siblingQuantity);
  let items: AjaxItem[] = [
    // Native cart edits since the design was added.
    ...Array.from({ length: cart.ordinaryLines ?? 1 }, (_, index) => ({
      key: `ordinary-${index}`,
      variant_id: 101,
      quantity: 1,
      properties: {},
    })),
    { key: 'old-custom', variant_id: 102, quantity: 2, properties: { _insignia_line_v3: v3Carrier('102', 1) } },
  ];
  const calls = { proposals: 0, accepts: 0, writes: 0 };
  const values = new Map<string, string>();
  const applicationId = '22222222-2222-4222-8222-222222222222';
  const live = createLiveDesignerPorts({
    source: {
      ...config,
      title: 'Shirt',
      placements: [
        { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
      ],
    },
    productId: '11',
    proxyBase: '/apps/insignia',
    cartRoot: '/',
    country: 'US',
    marketId: '42',
    locale: 'en',
    storeName: 'Store',
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) },
    fetchImpl: async (url, init = {}) => {
      const path = new URL(requestUrl(url), 'https://fixture.test').pathname,
        body = fetchBody(init);
      if (path.endsWith('/sessions'))
        return Response.json({
          capability: 'abc.def',
          sessionId: applicationId,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      if (path.endsWith('/cart-state')) return Response.json({ groups: [removed, sibling], repairRequired: true });
      if (path.endsWith('/quote-proposals')) {
        calls.proposals++;
        return Response.json({
          proposalId: '11111111-1111-4111-8111-111111111111',
          hash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          currency: 'USD',
          exponent: 2,
          customizedQuantity: 1,
          totalMinor: '1500',
          groups: [
            {
              productId: '11',
              quantity: 1,
              setupMinor: '0',
              customizationUnitMinor: '500',
              baseTotalMinor: '1000',
              totalMinor: '1500',
            },
          ],
          changedGroups: [],
        });
      }
      if (path.endsWith('/accept')) {
        calls.accepts++;
        return Response.json({
          quoteId: '11111111-1111-4111-8111-111111111111',
          setId: applicationId,
          validThroughDay: 30000,
          applicationId,
          buckets: [{ variantId: '102', quantity: 1, properties: { _insignia_line_v3: v3Carrier('102', 2) } }],
          desired: [sibling],
        });
      }
      if (path.endsWith('/confirm')) return Response.json({ id: applicationId, status: 'APPLIED' });
      if (init.method === 'POST') {
        calls.writes++;
        if (path.endsWith('/cart/update.js') && body.updates)
          items = items.filter((item) => body.updates?.[item.key] !== 0);
        else if (path.endsWith('/cart/add.js'))
          for (const item of body.items ?? [])
            items.push({
              key: 'new-custom',
              variant_id: item.id,
              quantity: item.quantity,
              properties: item.properties,
            });
      }
      return Response.json({ items, attributes: {}, currency: 'USD' });
    },
  });
  return {
    live,
    removed,
    calls,
    customized: () => items.filter((item) => item.properties._insignia_line_v3),
  };
}
async function withWindow<T>(run: () => Promise<T>): Promise<T> {
  const previous = Reflect.get(globalThis, 'window');
  Reflect.set(globalThis, 'window', new EventTarget());
  try {
    return await run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Reflect.set(globalThis, 'window', previous);
  }
}

test('removing one design from a cart that native edits pushed over capacity names the limit; Remove all still works (#371)', async () => {
  // 200 ordinary lines plus the retained sibling's line: over the 200-line cart limit.
  const lines = siblingRemoval({ ordinaryLines: 200 });
  await assert.rejects(lines.live.prepareRemoval(lines.removed), { code: 'CAPACITY_EXCEEDED', cartLines: true });
  assert.equal(lines.calls.proposals, 0, 'the limit is named before any proposal, as when adding');
  const review = await lines.live.prepareRemoval();
  assert.equal(review.groups.length, 0, 'Remove all needs no signed set, so the limit never blocks it');
  // The retained sibling alone is over the signed set's 10,000 items.
  const items = siblingRemoval({ siblingQuantity: 10_001 });
  await assert.rejects(items.live.prepareRemoval(items.removed), (error: object) => {
    assert.equal((error as { code?: string }).code, 'CAPACITY_EXCEEDED');
    assert.equal('cartLines' in error, false);
    return true;
  });
  assert.equal(items.calls.proposals, 0);
});

test('confirming a removal while another tab holds the cart lock is CART_BUSY; the retry applies the same accepted set (#371)', async () => {
  const app = siblingRemoval();
  await app.live.prepareRemoval(app.removed);
  let release!: () => void;
  let held!: () => void;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const lock = navigator.locks.request(
    'insignia-customized-cart-v2',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        held();
      }),
  );
  await holding;
  await assert.rejects(
    withWindow(() => app.live.confirmRemoval()),
    { code: 'CART_BUSY' },
  );
  assert.equal(app.calls.writes, 0, 'nothing was written while the lock was held');
  release();
  await lock;
  await withWindow(() => app.live.confirmRemoval());
  assert.equal(app.calls.accepts, 1, 'the retry reuses the accepted set instead of signing another');
  assert.equal(app.calls.proposals, 1);
  assert.deepEqual(
    app.customized().map((item) => item.key),
    ['new-custom'],
  );
});
