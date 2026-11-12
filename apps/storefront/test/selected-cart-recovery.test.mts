import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { CartReceipt, CartRequest } from '../../../frontend/designer/src/runtime.ts';
import type { BuyerConfig } from '../src/buyer.ts';
import { type AjaxBody, type AjaxItem, fetchBody, lineCarriers, requestUrl } from './support.mts';

/** One-line v3 carrier for a variant; the storefront decodes but never verifies it. */
const v3Carrier = (variantId: string, set = 1) =>
  lineCarriers([{ variantId, unitMinor: '1000' }], { set }).carriers[0] ?? '';

const bundle = await build({
  stdin: {
    contents:
      'export { createLiveDesignerPorts } from "./src/designer/live-ports.ts"; export { designerAlias } from "../../frontend/designer/src/live-config.ts";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const temporary = await mkdtemp(join(tmpdir(), 'insignia-live-cart-recovery-'));
const moduleFile = join(temporary, 'ports.mjs');
await writeFile(moduleFile, bundle.outputFiles[0]!.text);
after(() => rm(temporary, { recursive: true, force: true }));
const { createLiveDesignerPorts, designerAlias } = (await import(
  pathToFileURL(moduleFile).href
)) as typeof import('../src/designer/live-ports.ts') & typeof import('../../../frontend/designer/src/live-config.ts');

const source: BuyerConfig = {
  version: 'm7-config-v1',
  productId: '111',
  revisionId: 'x-revision',
  contentHash: 'a'.repeat(64),
  title: 'Shirt',
  shopCurrency: 'USD',
  methods: [{ id: 'print', label: 'Print' }],
  placements: [
    { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
  ],
  steps: [{ id: 'small', label: 'Small' }],
  options: [],
  variants: [
    {
      id: '101',
      label: 'X',
      available: true,
      selectedOptions: [{ name: 'Title', value: 'Default Title' }],
      baseUnitMinor: '1000',
    },
  ],
  geometry: {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'x-photo', width: 1000, height: 1000 },
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 100, height: 100 } }],
  },
  imageUrls: { 'x-photo': 'https://example.test/x.png' },
  decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '500' }],
  ready: true,
};

type Hooks = {
  /** Runs when the server accepts; may change the cart (another tab) or throw (a timed-out accept). */
  onAccept?(call: number, items: AjaxItem[]): void;
  /** Runs before Shopify processes an Ajax write; may throw (interrupted) or answer itself (a refusal). */
  onAjaxWrite?(path: string, items: AjaxItem[], body: AjaxBody): Response | undefined | void;
  /** Accepted lines in place of the single default one. */
  buckets?(set: number): { variantId: string; quantity: number; properties: Record<string, string> }[];
  /** Lines already in the buyer's cart. */
  initial?: AjaxItem[];
};
const ordinaryItem = (key: string): AjaxItem => ({ key, variant_id: 7, quantity: 1, properties: {} });

function fixture(hooks: Hooks = {}) {
  const values = new Map<string, string>();
  let items: AjaxItem[] = structuredClone(hooks.initial ?? []);
  const proposed: string[] = [];
  const accepted: string[] = [];
  const needsReview: boolean[] = [];
  let proposedGroups: unknown[] = [];
  const live = createLiveDesignerPorts({
    source,
    productId: '111',
    proxyBase: '/apps/insignia',
    cartRoot: '/',
    country: 'US',
    marketId: '42',
    locale: 'en',
    storeName: 'Store',
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) },
    onNeedsReview: (_canStart, _target, canRemoveAll) => needsReview.push(canRemoveAll),
    fetchImpl: async (url, init = {}) => {
      const path = new URL(requestUrl(url), 'https://fixture.test').pathname;
      const body = fetchBody(init);
      if (path.endsWith('/sessions'))
        return Response.json({
          capability: 'abc.def',
          sessionId: '11111111-1111-4111-8111-111111111111',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
      if (path.endsWith('/config')) return Response.json(source);
      if (/\/designs\/[^/]+$/.test(path))
        return Response.json({ id: path.split('/').at(-1), version: 1, value: JSON.parse(String(init.body)).group });
      if (path.endsWith('/cart-state')) {
        // Like the server: one acceptance per cart, so lines of two signed sets need review.
        const lines: { properties: Record<string, string> }[] = JSON.parse(String(init.body)).lines;
        if (new Set(lines.map((line) => line.properties._insignia_line_v3?.slice(0, 236))).size > 1)
          return Response.json({ code: 'REVIEW_REQUIRED', message: 'Review the customized cart' }, { status: 409 });
        return Response.json({
          groups: [],
          labels: {},
          quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          repairRequired: false,
        });
      }
      if (path.endsWith('/quote-proposals')) {
        const proposalId = `11111111-1111-4111-8111-${String(proposed.length + 1).padStart(12, '0')}`;
        proposed.push(proposalId);
        proposedGroups = JSON.parse(String(init.body)).groups;
        return Response.json({
          proposalId,
          hash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          currency: 'USD',
          exponent: 2,
          customizedQuantity: 1,
          totalMinor: '1500',
          groups: [
            {
              productId: '111',
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
        const proposalId = path.split('/').at(-2) ?? '';
        accepted.push(proposalId);
        hooks.onAccept?.(accepted.length, items);
        return Response.json({
          quoteId: '33333333-3333-4333-8333-333333333333',
          setId: '44444444-4444-4444-8444-444444444444',
          validThroughDay: 30000,
          applicationId: '22222222-2222-4222-8222-222222222222',
          // Each proposal is signed as its own set.
          buckets: hooks.buckets?.(proposed.indexOf(proposalId) + 2) ?? [
            {
              variantId: '101',
              quantity: 1,
              properties: { _insignia_line_v3: v3Carrier('101', proposed.indexOf(proposalId) + 2) },
            },
          ],
          desired: proposedGroups,
        });
      }
      if (path.endsWith('/confirm'))
        return Response.json({ id: '22222222-2222-4222-8222-222222222222', status: 'APPLIED' });
      if (init.method === 'POST') {
        const answer = hooks.onAjaxWrite?.(path, items, body);
        if (answer) return answer;
        if (path.endsWith('/cart/update.js')) {
          if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
        } else if (path.endsWith('/cart/change.js')) {
          items = items.map((item) =>
            item.key === body.id
              ? {
                  ...item,
                  key: `changed-${proposed.length}-${items.length}`,
                  quantity: body.quantity ?? item.quantity,
                  properties: body.properties ?? item.properties,
                }
              : item,
          );
        } else if (path.endsWith('/cart/add.js'))
          for (const item of body.items ?? [])
            items.push({
              key: `line-${proposed.length}-${items.length}`,
              variant_id: item.id,
              quantity: item.quantity,
              properties: item.properties,
            });
      }
      return Response.json({ items, attributes: {}, currency: 'USD' });
    },
  });
  const request: CartRequest = {
    requestId: 'request',
    idempotencyKey: 'attempt-key',
    operation: 'added',
    artworks: [],
    signal: new AbortController().signal,
    design: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      options: [],
      prints: [{ id: designerAlias('front'), artworkId: 'later', size: 0, method: designerAlias('print') }],
      quantities: {},
      variants: [{ variantId: '101', quantity: 1 }],
    },
  };
  return {
    live,
    request,
    proposed,
    accepted,
    needsReview,
    get items() {
      return items;
    },
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
const reviewRequired = (error: { reviewRequired?: boolean }) => error.reviewRequired === true;

test('a cart changed while the accept was in flight re-proposes; the next Add accepts the fresh proposal (#338)', async () => {
  const app = fixture({
    onAccept: (call, items) => {
      if (call === 1) items.push(ordinaryItem('7:theme-drawer'));
    },
  });
  await app.live.ports.review!.prepare(app.request);
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    reviewRequired,
    'the Designer returns to Review with a quote for the current cart',
  );
  assert.equal(app.proposed.length, 2, 'a fresh proposal against the refreshed cart');
  assert.equal(app.customized().length, 0);
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal((receipt as CartReceipt).kind, 'applied');
  assert.deepEqual(app.accepted, app.proposed, 'the second Add accepts the fresh proposal, not the cached one');
  assert.equal(app.customized().length, 1);
  assert.equal(app.items.length, 2, 'the ordinary line added meanwhile is kept');
});

test('after an accept timeout a cart change is still caught and the next Add runs a fresh proposal (#338)', async () => {
  const app = fixture({
    onAccept: (call) => {
      if (call === 1) throw new DOMException('The operation timed out.', 'TimeoutError');
    },
  });
  await app.live.ports.review!.prepare(app.request);
  await assert.rejects(withWindow(() => app.live.ports.cart.commit(app.request)));
  // The buyer changes the cart in the theme drawer before retrying.
  app.items.push(ordinaryItem('7:theme-drawer'));
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    reviewRequired,
  );
  assert.equal(app.proposed.length, 2);
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal((receipt as CartReceipt).kind, 'applied');
  assert.equal(app.accepted.at(-1), app.proposed[1]);
  assert.equal(app.customized().length, 1);
});

test('an unknown cart outcome offers repair in the Designer even with no customized line, and repair unblocks Add (#339)', async () => {
  let interrupt = true;
  const app = fixture({
    onAjaxWrite: (path) => {
      if (interrupt && path.endsWith('/cart/add.js'))
        throw new DOMException('The user aborted a request.', 'AbortError');
    },
  });
  await app.live.ports.review!.prepare(app.request);
  await assert.rejects(withWindow(() => app.live.ports.cart.commit(app.request)));
  assert.deepEqual(app.needsReview, [true], 'repair (remove all) is offered although no customized line is visible');
  interrupt = false;
  // The buyer confirms the repair; the tab is no longer blocked.
  await app.live.prepareRemoval();
  await withWindow(() => app.live.confirmRemoval());
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    reviewRequired,
  );
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal((receipt as CartReceipt).kind, 'applied');
  assert.equal(app.customized().length, 1);
});

test('a foreign edit racing the final removal still reports the exactly landed lines as applied', async () => {
  const app = fixture({
    initial: [
      { key: 'line-old', variant_id: 101, quantity: 1, properties: { _insignia_line_v3: v3Carrier('101', 9) } },
    ],
    onAjaxWrite: (path, items) => {
      if (path.endsWith('/cart/update.js')) items.push(ordinaryItem('7:other-tab'));
    },
  });
  await app.live.ports.review!.prepare(app.request);
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal((receipt as CartReceipt).kind, 'applied');
  assert.equal(app.proposed.length, 1, 'no second review of a design that is already in the cart');
  assert.deepEqual(
    app.customized().map((line) => line.key),
    ['line-1-1'],
    'the old line was replaced by the accepted one',
  );
});

const refusal = (description: string) =>
  Response.json({ status: 422, message: 'Cart Error', description }, { status: 422 });

test("a stock refusal shows Shopify's explanation, keeps no cached set and the next Add re-reviews (B2)", async () => {
  let refuse = true;
  const app = fixture({
    onAjaxWrite: (path) => (refuse && path.endsWith('/cart/add.js') ? refusal('Only 0 left in stock.') : undefined),
  });
  await app.live.ports.review!.prepare(app.request);
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    (error: { cartRejected?: boolean; detail?: string }) =>
      error.cartRejected === true && error.detail === 'Only 0 left in stock.',
  );
  refuse = false;
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    reviewRequired,
  );
  assert.equal(app.proposed.length, 2, 'the refused set is not reapplied');
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal((receipt as CartReceipt).kind, 'applied');
});

test('after a partially refused add the cart holds one set again, so the next Add can still review it (B1)', async () => {
  // Shopify adds the retained 101 line of the new set, then refuses the new 102 line.
  let refuse = true;
  const retained = (set: number) =>
    lineCarriers(
      [
        { variantId: '101', unitMinor: '1000' },
        { variantId: '102', unitMinor: '1000' },
      ],
      { set },
    ).carriers;
  const app = fixture({
    initial: [
      { key: 'line-old', variant_id: 101, quantity: 1, properties: { _insignia_line_v3: v3Carrier('101', 9) } },
    ],
    buckets: (set) =>
      retained(set).map((carrier, index) => ({
        variantId: String(101 + index),
        quantity: 1,
        properties: { _insignia_line_v3: carrier ?? '' },
      })),
    onAjaxWrite: (path, items, body) => {
      if (!refuse || !path.endsWith('/cart/add.js')) return undefined;
      for (const item of body.items ?? []) {
        if (String(item.id) === '102') return refusal('Only 0 left in stock.');
        items.push({
          key: `partial-${items.length}`,
          variant_id: item.id,
          quantity: item.quantity,
          properties: item.properties,
        });
      }
      return undefined;
    },
  });
  await app.live.ports.review!.prepare(app.request);
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    (error: { cartRejected?: boolean }) => error.cartRejected === true,
  );
  assert.deepEqual(
    app.customized().map((line) => line.properties._insignia_line_v3),
    [v3Carrier('101', 9)],
    'the buyer keeps exactly the lines they had',
  );
  refuse = false;
  await assert.rejects(
    withWindow(() => app.live.ports.cart.commit(app.request)),
    reviewRequired,
  );
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal((receipt as CartReceipt).kind, 'applied');
});
