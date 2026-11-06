import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { BuyerConfig } from '../src/buyer.ts';
import { type AjaxItem, fetchBody, requestUrl } from './support.mts';

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
      properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'member' },
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
      properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'old-member' },
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
              properties: { _insignia_quote_v2: 'new', _insignia_member_v2: 'new-member' },
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
