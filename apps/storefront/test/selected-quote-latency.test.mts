import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { DesignerQuoteReview } from '../../../frontend/designer/src/quote-review.ts';
import type { CartRequest } from '../../../frontend/designer/src/runtime.ts';
import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';
import type { RepairState } from '../src/designer/repair-state.ts';
import { type AjaxItem, fetchBody, lineCarriers, requestUrl } from './support.mts';

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
const temporary = await mkdtemp(join(tmpdir(), 'insignia-live-latency-'));
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

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}
const proposal = (proposalId: string) => ({
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

/** Every request is logged as `start <route>` / `end <route>`; listed routes wait for their gate. */
function fixture(options: {
  held?: Record<string, ReturnType<typeof gate>>;
  config?: BuyerConfig;
  saveStatus?: number;
  /** The owned groups the server reads from the cart's customized lines. */
  cartGroups?: DesiredGroup[];
}) {
  const log: string[] = [];
  const aborted: string[] = [];
  const values = new Map<string, string>();
  const items: AjaxItem[] = [];
  const attributes: Record<string, string> = {};
  const reviews: DesignerQuoteReview[] = [];
  const needsReview: RepairState[] = [];
  const priceRefreshes: BuyerConfig[] = [];
  let failCartRead = false;
  let proposals = 0;
  let proposedGroups: unknown[] = [];
  const route = (path: string, method: string) =>
    path.endsWith('/sessions')
      ? 'sessions'
      : path.endsWith('/config')
        ? 'config'
        : /\/designs\/[^/]+$/.test(path)
          ? 'designs'
          : path.endsWith('/quote-proposals')
            ? 'quote-proposals'
            : path.endsWith('/accept')
              ? 'accept'
              : path.endsWith('/confirm')
                ? 'confirm'
                : path.endsWith('/cart-state')
                  ? 'cart-state'
                  : `${method === 'POST' ? 'write' : 'read'} ${path.split('/').at(-1)}`;
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
    onNeedsReview: (state) => needsReview.push(state),
    onPriceRefresh: (next) => priceRefreshes.push(next),
    fetchImpl: async (url, init = {}) => {
      const path = new URL(requestUrl(url), 'https://fixture.test').pathname;
      const name = route(path, init.method ?? 'GET');
      log.push(`start ${name}`);
      init.signal?.addEventListener('abort', () => aborted.push(name), { once: true });
      const held = options.held?.[name];
      if (held) await held.opened;
      init.signal?.throwIfAborted();
      log.push(`end ${name}`);
      const body = fetchBody(init);
      if (name === 'sessions')
        return Response.json({
          capability: 'abc.def',
          sessionId: '11111111-1111-4111-8111-111111111111',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
      if (name === 'config') return Response.json(options.config ?? source);
      if (name === 'cart-state')
        return Response.json({
          groups: options.cartGroups ?? [],
          labels: {},
          quoteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          repairRequired: false,
        });
      if (name === 'designs') {
        if (options.saveStatus) return Response.json({ error: 'conflict' }, { status: options.saveStatus });
        return Response.json({ id: path.split('/').at(-1), version: 1, value: JSON.parse(String(init.body)).group });
      }
      if (name === 'quote-proposals') {
        proposedGroups = JSON.parse(String(init.body)).groups;
        return Response.json(proposal(`11111111-1111-4111-8111-${String(++proposals).padStart(12, '0')}`));
      }
      if (name === 'accept')
        return Response.json({
          quoteId: '33333333-3333-4333-8333-333333333333',
          setId: '44444444-4444-4444-8444-444444444444',
          validThroughDay: 30000,
          applicationId: '22222222-2222-4222-8222-222222222222',
          buckets: [{ variantId: '101', quantity: 1, properties: { _insignia_line_v3: v3Carrier('101', 2) } }],
          desired: proposedGroups,
        });
      if (name === 'confirm') return Response.json({ id: '22222222-2222-4222-8222-222222222222', status: 'APPLIED' });
      if (name === 'read cart.js' && failCartRead) return Response.json({ error: 'down' }, { status: 503 });
      if (name === 'write update.js' && body.attributes) Object.assign(attributes, body.attributes);
      if (name === 'write add.js')
        for (const item of body.items ?? [])
          items.push({
            key: `line-${items.length}`,
            variant_id: item.id,
            quantity: item.quantity,
            properties: item.properties,
          });
      return Response.json({ items, attributes, currency: 'USD' });
    },
  });
  const events: string[] = [];
  const request: CartRequest = {
    requestId: 'request',
    idempotencyKey: 'attempt-key',
    operation: 'added',
    artworks: [],
    signal: new AbortController().signal,
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
    log,
    aborted,
    reviews,
    needsReview,
    priceRefreshes,
    items,
    /** The groups the last proposal priced. */
    get proposedGroups() {
      return proposedGroups as DesiredGroup[];
    },
    failCartReads() {
      failCartRead = true;
    },
  };
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), 'condition not reached');
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

test('the proposal starts before the fresh config read resolves and the quote is presented only after both', async () => {
  const config = gate();
  const app = fixture({ held: { config } });
  let settled = false;
  const preparing = app.live.ports.review!.prepare(app.request).finally(() => {
    settled = true;
  });
  await until(() => app.log.includes('end quote-proposals'));
  assert.equal(app.log.includes('end config'), false, 'the proposal did not wait for config');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, 'presentation still waits for the fresh config');
  assert.equal(
    app.reviews.some((review) => review.totalMinor !== undefined),
    false,
  );
  config.open();
  await preparing;
  assert.equal(app.priceRefreshes.length, 1);
  assert.equal(app.reviews.at(-1)?.totalMinor, '1500');
});

test('the draft save runs concurrently with the proposal and a failed save never blocks the quote (#337)', async () => {
  const designs = gate();
  const app = fixture({ held: { designs } });
  const preparing = app.live.ports.review!.prepare(app.request);
  await until(() => app.log.includes('end quote-proposals'));
  assert.equal(app.log.includes('end designs'), false, 'the proposal did not wait for the draft save');
  designs.open();
  await preparing;
  assert.equal(app.reviews.at(-1)?.totalMinor, '1500');

  // The draft only lets the buyer reopen the design later; the proposal never reads it.
  const failing = fixture({ saveStatus: 500 });
  await failing.live.ports.review!.prepare(failing.request);
  assert.equal(failing.reviews.at(-1)?.totalMinor, '1500', 'the quote is presented although the draft was not saved');
});

test('a changed publication found by the fresh config takes precedence over an in-flight proposal', async () => {
  const proposals = gate();
  const config = gate();
  const app = fixture({
    held: { 'quote-proposals': proposals, config },
    config: { ...source, revisionId: 'republished', contentHash: 'f'.repeat(64) },
  });
  const preparing = app.live.ports.review!.prepare(app.request);
  await until(() => app.log.includes('start quote-proposals'));
  config.open();
  await assert.rejects(preparing, /Published configuration changed/);
  assert.deepEqual(
    app.needsReview,
    [{ cause: 'review-required', canStart: true, canRemoveGroup: false, canRemoveAll: false }],
    'the republish review path offers no removal of a line the cart does not hold (#371)',
  );
  assert.ok(app.aborted.includes('quote-proposals'), 'the stale in-flight proposal is abandoned');
  assert.equal(app.priceRefreshes.length, 0);
  assert.equal(
    app.reviews.some((review) => review.totalMinor !== undefined),
    false,
  );
  proposals.open();
});

test('after a republish, Remove this customization is offered only while the cart still holds its line (#371)', async () => {
  const options: Parameters<typeof fixture>[0] = {};
  const app = fixture(options);
  await app.live.ports.review!.prepare(app.request);
  const group = app.proposedGroups[0];
  assert.ok(group);
  // The design was opened from its cart line; then the product is republished.
  app.live.registerDesign(app.request.design.id, group);
  app.items.push({ key: 'own', variant_id: 101, quantity: 1, properties: { _insignia_line_v3: v3Carrier('101') } });
  options.config = { ...source, revisionId: 'republished', contentHash: 'f'.repeat(64) };
  const republished = async (cartGroups: DesiredGroup[]) => {
    options.cartGroups = cartGroups;
    app.needsReview.length = 0;
    await assert.rejects(app.live.ports.review!.prepare(app.request), /Published configuration changed/);
    return app.needsReview;
  };
  assert.deepEqual(
    await republished([group]),
    [{ cause: 'review-required', canStart: true, canRemoveGroup: true, canRemoveAll: true }],
    'its own line is still in the cart',
  );
  // Another tab removed this design's line; a different customization is in the cart.
  const sibling: DesiredGroup = {
    ...group,
    design: {
      ...group.design,
      placements: group.design.placements.map((placement) => ({
        ...placement,
        artwork: { kind: 'deferred' as const, intentId: 'sibling' },
      })),
    },
  };
  assert.deepEqual(
    await republished([sibling]),
    [{ cause: 'review-required', canStart: true, canRemoveGroup: false, canRemoveAll: true }],
    'a line removed elsewhere is never offered for removal',
  );
});

test('Add on a current prepared quote never reports "Preparing quote"; a failed pre-acceptance read still does', async () => {
  const app = fixture({});
  await app.live.ports.review!.prepare(app.request);
  const receipt = await withWindow(() => app.live.ports.cart.commit(app.request));
  assert.equal(receipt.kind, 'applied');
  assert.equal(app.events.includes('preparing'), false, 'no preparation flash on an already prepared quote');
  assert.equal(app.events[0], 'mutating');

  const failing = fixture({});
  await failing.live.ports.review!.prepare(failing.request);
  failing.failCartReads();
  await assert.rejects(withWindow(() => failing.live.ports.cart.commit(failing.request)));
  assert.deepEqual(failing.events, ['preparing'], 'a failure before issuance stays a preparation failure');
});
