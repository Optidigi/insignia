import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema, placementProductSchema } from '@insignia/contracts';
import { copyPlacementSetup } from '../../examples/admin/support/placement-setup-copy.mts';
import { createDemoPlacementSetupCopyPorts } from '../../examples/admin/support/placement-setup-copy-demo.mts';
import { createSelectedProductCopyPorts } from '../../src/islands/selected-product-copy.ts';

const intent = {
  sourceSignature: 'a'.repeat(64),
  selectedViewIds: ['front'],
  includeMethods: true,
  includePrices: true,
};
const targetId = 'gid://shopify/Product/111';
const source = placementProductSchema.parse({
  id: 'gid://shopify/Product/222',
  title: 'Source',
  images: [],
  methods: [{ id: 'print', name: 'Printing', pricing: 'product', amount: '' }],
  views: [
    {
      id: 'front',
      name: 'Front',
      imageUrl: 'https://assets.example/front.png',
      imageWidth: 800,
      imageHeight: 800,
      placements: [
        {
          id: 'chest',
          name: 'Chest',
          rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
          widthCm: '10',
          heightCm: '10',
          methodIds: ['print'],
          sizes: [{ id: 'small', name: 'Small', widthPercent: '100', prices: { print: '4.00' } }],
          logoLaterAllowed: false,
        },
      ],
    },
  ],
});
const base = MerchantDraftSchema.parse({
  version: 'm5-merchant-draft-v1',
  mode: 'required',
  shopCurrency: 'USD',
  methods: [],
  placements: [],
  productionOptions: [],
  pricingRules: [],
  geometry: { version: 'm5-geometry-v1', views: [], steps: [] },
  selectedSetup: {
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: { id: targetId, title: 'Target', images: [], methods: [], views: [] },
  },
});
const authority = {
  version: 'merchant-preferences-v1',
  authority: 'a'.repeat(64),
  canEdit: true,
  shop: 'example.myshopify.com',
  guidanceVersion: '0',
  wordingVersion: '0',
  guidance: { dismissed: false, completedSteps: [] },
  overlays: { en: { locale: 'en', messages: {} } },
};
function fixture(loseReply = false) {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  let draft = structuredClone(base),
    version = '1',
    lose = loseReply;
  const writes: { key: string | null; body: string }[] = [];
  const request = async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path === '/api/admin/preferences') return authority;
    if (path.startsWith('/api/admin/products?'))
      return {
        products: [
          {
            id: targetId,
            title: 'Target',
            status: 'ACTIVE',
            imageUrl: null,
            variants: [],
            configurationSummary: { state: 'not_configured', methods: [], locations: [] },
          },
        ],
        nextCursor: null,
      };
    if (!init?.method)
      return {
        product: { id: targetId, title: 'Target', status: 'ACTIVE', imageUrl: null, images: [], variants: [] },
        config: {
          configId: 'target-config',
          installationGeneration: '1',
          currentShopCurrency: 'USD',
          draftVersion: version,
          draft,
          publication: {
            state: 'DRAFT',
            revisionId: null,
            sourceDraftVersion: null,
            requestKey: null,
            activeRevisionId: null,
            reason: null,
            requiresAllChannelHold: false,
            functionReadiness: null,
          },
          publishEligibility: { allowed: true, reason: null },
        },
      };
    const body = String(init.body);
    writes.push({ key: new Headers(init.headers).get('Idempotency-Key'), body });
    draft = MerchantDraftSchema.parse(JSON.parse(body).draft);
    version = '2';
    if (lose) {
      lose = false;
      throw new Error('Reply lost after copy commit');
    }
    return { kind: 'saved', draftVersion: version };
  };
  return { storage, request, writes };
}
function prepare(target: ReturnType<typeof placementProductSchema.parse>) {
  const copied = copyPlacementSetup(source, target, {
    selectedViewIds: ['front'],
    includeMethods: true,
    includePrices: true,
  });
  if (copied.kind !== 'copied') throw new Error('Copy should prepare an empty target');
  return copied.product;
}
test('real copy saves an independent product-owned snapshot with new identities and required alignment review', async () => {
  const f = fixture(),
    ports = createSelectedProductCopyPorts(f);
  await ports.loadCatalog(new AbortController().signal);
  const [{ product: target } = { product: null }] = await ports.hydrate([targetId], new AbortController().signal);
  assert.ok(target);
  assert.equal(ports.inspect(target).readiness, 'ready');
  const copied = prepare(target);
  await ports.save(copied, intent);
  const payload = JSON.parse(f.writes[0]?.body ?? '{}').draft.selectedSetup;
  assert.deepEqual(
    payload.methodBindings,
    {},
    'copy does not infer catalogue inheritance from matching method ids or prices',
  );
  assert.notEqual(payload.product.views[0].id, 'front');
  assert.equal(payload.product.views[0].imageUrl, '');
  assert.equal(payload.product.views[0].needsAlignmentReview, true);
  assert.equal(payload.product.views[0].placements[0].sizes[0].prices.print, '4.00');
  assert.equal(ports.inspect(target).readiness, 'configured');
  await assert.rejects(() => ports.save(copied, intent), /already configured/);
  assert.equal(f.writes.length, 1);
});
test('a partial copy retry settles only its original exact saved intent, not freshly regenerated ids', async () => {
  const f = fixture(true),
    ports = createSelectedProductCopyPorts(f);
  await ports.loadCatalog(new AbortController().signal);
  const [{ product: target } = { product: null }] = await ports.hydrate([targetId], new AbortController().signal);
  if (!target) throw new Error('Target expected');
  await assert.rejects(() => ports.save(prepare(target), intent), /lost/);
  const reloaded = createSelectedProductCopyPorts(f);
  await reloaded.loadCatalog(new AbortController().signal);
  const [{ product: observedTarget } = { product: null }] = await reloaded.hydrate(
    [targetId],
    new AbortController().signal,
  );
  if (!observedTarget) throw new Error('Target expected after reload');
  assert.equal(reloaded.inspect(observedTarget).readiness, 'ready');
  await assert.rejects(
    () => reloaded.save(prepare({ ...observedTarget, views: [] }), { ...intent, includePrices: false }),
    /original copy intent/,
  );
  await reloaded.save(prepare({ ...observedTarget, views: [] }), intent);
  assert.deepEqual(
    f.writes[1],
    f.writes[0],
    'a retry uses original CAS/key/snapshot despite regenerated local copy ids',
  );
  assert.equal(reloaded.inspect(observedTarget).readiness, 'configured');
});

test('independent copied methods do not share mutable translated descriptions with the source', () => {
  const candidate = structuredClone(source);
  const method = candidate.methods[0];
  if (!method) throw new Error('Method expected');
  method.translations = { nl: { name: 'Bedrukken', explanation: 'Originele uitleg' } };
  const empty = placementProductSchema.parse({ id: targetId, title: 'Target', images: [], methods: [], views: [] });
  const copied = copyPlacementSetup(candidate, empty, {
    selectedViewIds: ['front'],
    includeMethods: true,
    includePrices: true,
  });
  if (copied.kind !== 'copied') throw new Error('Copy expected');
  assert.ok(method.translations?.nl);
  method.translations.nl.explanation = 'Later gewijzigd';
  assert.equal(copied.product.methods[0]?.translations?.nl?.explanation, 'Originele uitleg');
});
test('independent copy preserves retained production definitions and labels using fresh option/value identities', () => {
  const retained = {
    ...source,
    productionChoices: {
      definitions: [{ id: 'thread', allowedValueIds: ['blue', 'red'] }],
      labels: { options: { thread: 'Thread colour' }, values: { thread: { blue: 'Blue', red: 'Red' } } },
    },
  };
  let next = 0;
  const result = copyPlacementSetup(retained, base.selectedSetup!.product, {
    selectedViewIds: ['front'],
    includeMethods: true,
    includePrices: true,
    createId: (kind) => `${kind}-${++next}`,
  });
  assert.equal(result.kind, 'copied');
  if (result.kind !== 'copied') throw new Error('copy');
  const choice = result.product.productionChoices!;
  assert.notEqual(choice.definitions[0]?.id, 'thread');
  assert.equal(choice.definitions[0]?.allowedValueIds.includes('blue'), false);
  assert.deepEqual(Object.values(choice.labels.options ?? {}), ['Thread colour']);
  assert.deepEqual(Object.values(Object.values(choice.labels.values ?? {})[0] ?? {}), ['Blue', 'Red']);
  choice.labels.options![choice.definitions[0]!.id] = 'Changed';
  assert.equal(retained.productionChoices.labels.options.thread, 'Thread colour');
});

test('catalog discovery uses existing summaries without loading product snapshots', async () => {
  const f = fixture();
  let details = 0;
  const ports = createSelectedProductCopyPorts({
    ...f,
    request: async (path, init) => {
      if (path.startsWith('/api/admin/products?'))
        return {
          products: Array.from({ length: 20 }, (_, index) => ({
            id: `gid://shopify/Product/${111 + index}`,
            title: `Product ${index}`,
            status: 'ACTIVE',
            imageUrl: null,
            variants: [],
            configurationSummary: { state: 'not_configured', methods: [], locations: [] },
          })),
          nextCursor: null,
        };
      if (path !== '/api/admin/preferences') details++;
      return f.request(path, init);
    },
  });
  const discovery = await ports.loadCatalog(new AbortController().signal);
  assert.equal(discovery.length, 20);
  assert.equal(details, 0);
  assert.equal('views' in discovery[0]!, false);
  const snapshots = await ports.hydrate([targetId, targetId], new AbortController().signal);
  assert.equal(snapshots.length, 1);
  assert.equal(details, 1);
  assert.equal(f.writes.length, 0);
});

test('unavailable selected snapshots stay explicit and cancellation cannot admit late snapshots', async () => {
  const f = fixture();
  const ports = createSelectedProductCopyPorts({
    ...f,
    request: async (path, init) => {
      if (path.endsWith('/config')) throw new Error('Unavailable');
      return f.request(path, init);
    },
  });
  await ports.loadCatalog(new AbortController().signal);
  assert.deepEqual(await ports.hydrate([targetId], new AbortController().signal), [{ id: targetId, product: null }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(ports.hydrate([targetId], controller.signal));
  assert.equal(f.writes.length, 0);
});

test('discovery rejects duplicate products and looping cursors', async () => {
  for (const duplicate of [true, false]) {
    const f = fixture();
    const ports = createSelectedProductCopyPorts({
      ...f,
      request: async (path, init) => {
        if (path.startsWith('/api/admin/products?'))
          return {
            products: duplicate
              ? [{ id: targetId, title: 'Target', status: 'ACTIVE', imageUrl: null, variants: [] }]
              : [],
            nextCursor: 'same',
          };
        return f.request(path, init);
      },
    });
    await assert.rejects(
      ports.loadCatalog(new AbortController().signal),
      duplicate ? /Duplicate catalog/ : /cursor did not advance/,
    );
    assert.equal(f.writes.length, 0);
  }
});

test('hydration retains concurrency four and does not admit a cancelled late response', async () => {
  const f = fixture();
  let active = 0,
    peak = 0;
  const ports = createSelectedProductCopyPorts({
    ...f,
    request: async (path, init) => {
      if (path.endsWith('/config')) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
      }
      return f.request(path, init);
    },
  });
  await ports.loadCatalog(new AbortController().signal);
  await ports.hydrate(
    Array.from({ length: 8 }, (_, i) => `gid://shopify/Product/${111 + i}`),
    new AbortController().signal,
  );
  assert.equal(peak, 4);
  const controller = new AbortController();
  const pending = ports.hydrate([targetId], controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(f.writes.length, 0);
});

test('fresh authority loss refuses saving a reviewed target without replacing write identity', async () => {
  const f = fixture();
  let changed = false;
  const ports = createSelectedProductCopyPorts({
    ...f,
    request: async (path, init) => {
      if (changed && path === '/api/admin/preferences') return { ...authority, authority: 'b'.repeat(64) };
      return f.request(path, init);
    },
  });
  await ports.loadCatalog(new AbortController().signal);
  const [snapshot] = await ports.hydrate([targetId], new AbortController().signal);
  assert.ok(snapshot?.product);
  changed = true;
  await assert.rejects(ports.save(prepare(snapshot.product), intent), /authority changed/);
  assert.equal(f.writes.length, 0);
});

test('a draft summary stays provisional until its empty snapshot establishes target eligibility', async () => {
  const f = fixture();
  const ports = createSelectedProductCopyPorts({
    ...f,
    request: async (path, init) => {
      const value = await f.request(path, init);
      if (path.startsWith('/api/admin/products?'))
        return {
          products: [
            {
              id: targetId,
              title: 'Empty draft',
              status: 'ACTIVE',
              imageUrl: null,
              variants: [],
              configurationSummary: { state: 'draft', methods: [], locations: [] },
            },
          ],
          nextCursor: null,
        };
      return value;
    },
  });
  const [discovery] = await ports.loadCatalog(new AbortController().signal);
  assert.equal(discovery?.configured, null);
  const [snapshot] = await ports.hydrate([targetId], new AbortController().signal);
  assert.ok(snapshot?.product);
  assert.equal(ports.inspect(snapshot.product).readiness, 'ready');
  assert.equal(f.writes.length, 0);
});

test('demo discovery and hydration expose the saved copy as a source instead of its empty example', async (t) => {
  const memory = new Map<string, string>([['insignia-placement-example', 'copy-ready']]);
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  const id = 'gid://shopify/Product/15468473450880';
  const original = { ...source, id };
  t.mock.method(globalThis, 'fetch', async () => Response.json([original]));
  const ports = createDemoPlacementSetupCopyPorts();
  assert.equal((await ports.loadCatalog(new AbortController().signal))[0]?.configured, false);
  const saved = { ...original, views: original.views.map((view) => ({ ...view, id: 'saved-front' })) };
  await ports.save(saved, intent);
  assert.equal((await ports.loadCatalog(new AbortController().signal))[0]?.configured, true);
  const [snapshot] = await ports.hydrate([id], new AbortController().signal);
  assert.equal(snapshot?.product?.views[0]?.id, 'saved-front');
});

test('cancelled hydration drains dispatched siblings and cannot replace a later review snapshot', async () => {
  const f = fixture();
  let entered = 0;
  let started!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const releases: (() => void)[] = [];
  const gates = Array.from(
    { length: 2 },
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  );
  const ports = createSelectedProductCopyPorts({
    ...f,
    request: async (path, init) => {
      if (path.endsWith('/config') && entered < 2) {
        const gate = gates[entered++];
        if (entered === 2) started();
        await gate;
      }
      return f.request(path, init);
    },
  });
  await ports.loadCatalog(new AbortController().signal);
  const controller = new AbortController();
  let settled = false;
  const pending = ports.hydrate([targetId, source.id], controller.signal).finally(() => {
    settled = true;
  });
  pending.catch(() => {});
  try {
    await bothStarted;
    controller.abort();
    const [releaseFirst, releaseSecond] = releases;
    assert.ok(releaseFirst && releaseSecond);
    releaseFirst();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'The cancelled owner must drain its other dispatched snapshot');
    releaseSecond();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(ports.inspect({ ...source, id: targetId }).readiness, 'unavailable');
    const [retry] = await ports.hydrate([targetId], new AbortController().signal);
    assert.ok(retry?.product);
    assert.equal(ports.inspect(retry.product).readiness, 'ready');
    assert.equal(f.writes.length, 0);
  } finally {
    controller.abort();
    for (const release of releases) release();
    await Promise.allSettled([pending]);
  }
});
