import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { DesignerQuoteReview } from '../../../frontend/designer/src/quote-review.ts';
import type { CartReceipt, CartRequest } from '../../../frontend/designer/src/runtime.ts';
import type { BuyerConfig } from '../src/buyer.ts';
import { type AjaxItem, fetchBody, requestUrl } from './support.mts';

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
const temporary = await mkdtemp(join(tmpdir(), 'insignia-live-expiry-'));
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

type Proposal = { hash: string; totalMinor: string; status?: number };
function fixture(proposals: Proposal[]) {
  const values = new Map<string, string>();
  let items: AjaxItem[] = [];
  const attributes: Record<string, string> = {};
  const proposed: string[] = [];
  const accepted: { id: string; hash: string; idempotencyKey: string }[] = [];
  const reviews: DesignerQuoteReview[] = [];
  let ajaxWrites = 0;
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
    onReview: (review) => reviews.push(review),
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
      if (path.endsWith('/quote-proposals')) {
        const next = proposals[proposed.length];
        assert(next, 'Unexpected additional proposal');
        const proposalId = `11111111-1111-4111-8111-${String(proposed.length + 1).padStart(12, '0')}`;
        proposed.push(proposalId);
        proposedGroups = JSON.parse(String(init.body)).groups;
        if (next.status) return Response.json({ code: 'UNAVAILABLE' }, { status: next.status });
        return Response.json({
          proposalId,
          hash: next.hash,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          currency: 'USD',
          exponent: 2,
          customizedQuantity: 1,
          totalMinor: next.totalMinor,
          groups: [
            {
              productId: '111',
              quantity: 1,
              setupMinor: '0',
              customizationUnitMinor: '500',
              baseTotalMinor: '1000',
              totalMinor: next.totalMinor,
            },
          ],
          changedGroups: [],
        });
      }
      if (path.endsWith('/accept')) {
        const parsed = JSON.parse(String(init.body));
        accepted.push({ id: path.split('/').at(-2)!, hash: parsed.hash, idempotencyKey: parsed.idempotencyKey });
        return Response.json({
          quoteId: '33333333-3333-4333-8333-333333333333',
          setId: '44444444-4444-4444-8444-444444444444',
          validThroughDay: 30000,
          applicationId: '22222222-2222-4222-8222-222222222222',
          buckets: [
            { variantId: '101', quantity: 1, properties: { _insignia_quote_v2: 'new', _insignia_member_v2: 'member' } },
          ],
          desired: proposedGroups,
        });
      }
      if (path.endsWith('/confirm'))
        return Response.json({ id: '22222222-2222-4222-8222-222222222222', status: 'APPLIED' });
      if (init.method === 'POST') {
        ajaxWrites++;
        if (path.endsWith('/cart/update.js')) {
          if (body.updates) items = items.filter((item) => body.updates?.[item.key] !== 0);
          if (body.attributes) Object.assign(attributes, body.attributes);
        } else if (path.endsWith('/cart/add.js'))
          for (const item of body.items ?? [])
            items.push({
              key: `line-${items.length}`,
              variant_id: item.id,
              quantity: item.quantity,
              properties: item.properties,
            });
      }
      return Response.json({ items, attributes, currency: 'USD' });
    },
  });
  const controller = new AbortController();
  const events: string[] = [];
  const request: CartRequest = {
    requestId: 'request',
    idempotencyKey: 'attempt-key',
    operation: 'added',
    artworks: [],
    signal: controller.signal,
    onPreparing: () => events.push('preparing'),
    onMutating: () => events.push('mutating'),
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
    events,
    proposed,
    accepted,
    reviews,
    get ajaxWrites() {
      return ajaxWrites;
    },
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
async function afterExpiry<T>(run: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60_000;
  try {
    return await run();
  } finally {
    Date.now = originalNow;
  }
}

test('Add after proposal expiry re-proposes once and applies in the same click when the material hash is unchanged', async () => {
  const app = fixture([
    { hash: 'b'.repeat(64), totalMinor: '1500' },
    { hash: 'b'.repeat(64), totalMinor: '1500' },
  ]);
  await app.live.ports.review!.prepare(app.request);
  const displayed = app.reviews.length;
  const receipt = await afterExpiry(() => withWindow(() => app.live.ports.cart.commit(app.request)));
  assert.equal((receipt as CartReceipt).kind, 'applied');
  assert.equal(app.proposed.length, 2, 'exactly one fresh proposal');
  assert.deepEqual(
    app.accepted.map(({ id, hash }) => ({ id, hash })),
    [{ id: app.proposed[1], hash: 'b'.repeat(64) }],
    'only the fresh proposal carrying the displayed hash is accepted',
  );
  assert.equal(app.accepted[0]?.idempotencyKey, app.request.idempotencyKey);
  assert.equal(app.ajaxWrites > 0, true);
  assert(
    app.reviews.slice(displayed).every((review) => review.totalMinor !== undefined),
    'refreshing an already-displayed design never blanks its displayed total',
  );
});

test('Add after proposal expiry with a changed material hash shows the new terms and requires another click', async () => {
  const app = fixture([
    { hash: 'b'.repeat(64), totalMinor: '1500' },
    { hash: 'c'.repeat(64), totalMinor: '1700' },
  ]);
  await app.live.ports.review!.prepare(app.request);
  await afterExpiry(async () => {
    await assert.rejects(
      withWindow(() => app.live.ports.cart.commit(app.request)),
      (error: { reviewRequired?: boolean; expiresAt?: string }) =>
        error.reviewRequired === true && Date.parse(error.expiresAt ?? '') > Date.now(),
    );
    assert.equal(app.accepted.length, 0);
    assert.equal(app.ajaxWrites, 0);
    assert.equal(app.reviews.at(-1)?.totalMinor, '1700');
    const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
    assert.equal((receipt as CartReceipt).kind, 'applied');
  });
  assert.equal(app.proposed.length, 2);
  assert.deepEqual(
    app.accepted.map(({ id, hash }) => ({ id, hash })),
    [{ id: app.proposed[1], hash: 'c'.repeat(64) }],
  );
});

test('a failed re-proposal after expiry accepts nothing and surfaces the existing failure', async () => {
  const app = fixture([
    { hash: 'b'.repeat(64), totalMinor: '1500' },
    { hash: '', totalMinor: '', status: 503 },
  ]);
  await app.live.ports.review!.prepare(app.request);
  await afterExpiry(async () => {
    await assert.rejects(
      withWindow(() => app.live.ports.cart.commit(app.request)),
      (error: { reviewRequired?: boolean }) => error.reviewRequired !== true,
    );
  });
  assert.equal(app.accepted.length, 0);
  assert.equal(app.ajaxWrites, 0);
});
