import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { Design } from '../../../frontend/designer/src/model.ts';
import type { BuyerConfig } from '../src/buyer.ts';
import { requestUrl } from './support.mts';

/**
 * #366: the Designer saves the unfinished design to its one draft a couple of seconds after the last change,
 * spaced so normal editing stays far below the session's 60 writes per minute.
 */
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
const temporary = await mkdtemp(join(tmpdir(), 'insignia-draft-autosave-'));
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
const DESIGN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** The design as its cart line holds it. */
const lineGroup = (quantity: number) => ({
  productId: '111',
  configRevisionId: 'x-revision',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      {
        placementId: 'front',
        methodId: 'print',
        stepId: 'small',
        artwork: { kind: 'deferred' as const, intentId: 'later-intent' },
        position: { xMicros: 500_000, yMicros: 500_000 },
      },
    ],
    options: [],
  },
  variants: [{ variantId: '101', quantity }],
});
const design = (quantity: number, x = 50): Design => ({
  id: DESIGN_ID,
  options: [],
  prints: [
    { id: designerAlias('front'), artworkId: 'later', size: 0, method: designerAlias('print'), position: { x, y: 50 } },
  ],
  quantities: {},
  variants: quantity ? [{ variantId: '101', quantity }] : [],
});

/** Storage every tab shares (`localStorage`), where the latest unfinished design's pointer lives. */
function sharedStorage() {
  const data = new Map<string, string>();
  const storage = {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  return storage;
}
const LATEST = 'insignia:selected-design-latest:v1:/apps/insignia:111';

function fixture(options: { saveStatus?: number; statuses?: number[] } = {}) {
  const saves: { expectedVersion: number; group: { variants: unknown[] } }[] = [];
  const shared = sharedStorage();
  let version = 0;
  const live = createLiveDesignerPorts({
    source,
    productId: '111',
    proxyBase: '/apps/insignia',
    cartRoot: '/',
    country: 'US',
    marketId: '42',
    locale: 'en',
    storeName: 'Store',
    storage: { getItem: () => null, setItem: () => {} },
    fetchImpl: async (url, init = {}) => {
      const path = new URL(requestUrl(url), 'https://fixture.test').pathname;
      if (path.endsWith('/sessions'))
        return Response.json({
          capability: 'abc.def',
          sessionId: '11111111-1111-4111-8111-111111111111',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
      // Only a design the refused writes never created is restored here: the server has none.
      if (path.endsWith('/restore')) return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
      if (/\/designs\/[^/]+$/.test(path)) {
        const body = JSON.parse(String(init.body));
        saves.push(body);
        const status = options.statuses?.shift();
        if (status) return Response.json({ code: 'UNAVAILABLE' }, { status });
        if (options.saveStatus)
          return Response.json(
            { code: 'RATE_LIMITED', message: 'limited', requestId: 'r' },
            { status: options.saveStatus },
          );
        if (body.expectedVersion !== version) return Response.json({ code: 'CONFLICT' }, { status: 409 });
        return Response.json({ id: DESIGN_ID, version: ++version, value: body.group });
      }
      return Response.json({ code: 'UNAVAILABLE' }, { status: 503 });
    },
  });
  const changed = (value: Design) => {
    assert.ok(live.ports.draft, 'the live host takes design changes');
    live.ports.draft.changed(value);
  };
  const reverted = (id = DESIGN_ID) => {
    assert.ok(live.ports.draft);
    live.ports.draft.reverted(id);
  };
  return { live, saves, changed, reverted, shared };
}
/** Lets fetch, digest and promise chains run between mocked timer ticks. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 100) {
    mock.timers.tick(Math.min(100, left));
    await settle();
  }
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 }));
afterEach(() => mock.timers.reset());

test('artwork with no quantities is saved to its draft about two seconds after the last change', async () => {
  const { changed, saves } = fixture();
  changed(design(0, 40));
  await advance(1000);
  changed(design(0, 45));
  await advance(1900);
  assert.equal(saves.length, 0, 'still editing: nothing is saved yet');
  await advance(200);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]?.group.variants, [], 'a draft without sizes or colours');
  assert.equal(saves[0]?.expectedVersion, 0);
  // An edit after that updates the same draft.
  changed(design(3, 45));
  await advance(10_000);
  assert.equal(saves.length, 2);
  assert.equal(saves[1]?.expectedVersion, 1);
  assert.deepEqual(saves[1]?.group.variants, [{ variantId: '101', quantity: 3 }]);
});

test('a minute of rapid editing stays far below the 60 writes per minute and ends with the latest design saved', async () => {
  const { changed, saves } = fixture();
  // Worst case for a debounce: every edit lands just after the previous one would have saved.
  let x = 10;
  for (let elapsed = 0; elapsed < 60_000; elapsed += 2_100) {
    changed(design(1, x++));
    await advance(2_100);
  }
  // Fast typing never pauses long enough to save in between.
  for (let elapsed = 0; elapsed < 10_000; elapsed += 150) {
    changed(design(2, x++));
    await advance(150);
  }
  await advance(10_000);
  // Each draft write costs two of the session's 60 writes a minute (admission and the save itself).
  assert.ok(saves.length <= 8, `${saves.length} draft writes in 70 seconds`);
  const last = saves.at(-1)?.group as unknown as { design: { placements: { position?: { xMicros: number } }[] } };
  assert.equal(last.design.placements[0]?.position?.xMicros, (x - 1) * 10_000, 'the last edit is saved');
});

test('an unchanged design is not saved again', async () => {
  const { changed, saves } = fixture();
  changed(design(2));
  await advance(3_000);
  changed(design(2));
  await advance(10_000);
  assert.equal(saves.length, 1);
});

test('after the session refuses a draft write, autosave stops so it cannot use up quotes and cart writes', async () => {
  const { changed, saves } = fixture({ saveStatus: 429 });
  changed(design(1));
  await advance(3_000);
  assert.equal(saves.length, 1);
  for (let quantity = 2; quantity < 8; quantity++) {
    changed(design(quantity));
    await advance(6_000);
  }
  assert.equal(saves.length, 1);
});

test('Start a new design cancels the pending save of the design it discards', async () => {
  const { changed, saves, live } = fixture();
  changed(design(1));
  await advance(1_000);
  await live.discardDrafts();
  await advance(10_000);
  assert.equal(saves.length, 0);
});

test('a new design emptied after its autosave cancels the pending save and is no longer offered (#366)', async () => {
  const { changed, reverted, saves, shared } = fixture();
  changed(design(0));
  await advance(3_000);
  assert.equal(saves.length, 1);
  assert.equal(JSON.parse(shared.data.get(LATEST) ?? 'null')?.id, DESIGN_ID, 'offered after a reload');
  changed(design(2));
  await advance(1_000);
  // The buyer removes the artwork before that edit is saved.
  reverted();
  await advance(15_000);
  assert.equal(saves.length, 1, 'the pending edit is not saved');
  assert.equal(shared.data.get(LATEST), undefined, 'nothing is offered after a reload');
});

test('a cart line undone back to the cart saves the cart version, so reopening it starts from the cart (#366)', async () => {
  const { live, changed, reverted, saves, shared } = fixture();
  const cartLine = lineGroup(3);
  live.registerDesign(DESIGN_ID, cartLine);
  changed(design(5));
  await advance(3_000);
  assert.deepEqual(saves.at(-1)?.group.variants, [{ variantId: '101', quantity: 5 }]);
  reverted();
  await advance(12_000);
  assert.equal(saves.length, 2);
  assert.deepEqual(saves.at(-1)?.group.variants, [{ variantId: '101', quantity: 3 }]);
  assert.equal(shared.data.get(LATEST), undefined, 'a cart line is never offered as an unfinished new design');
});

test('a failed autosave is retried once after the spacing, then waits for the next change (#366)', async () => {
  const { changed, saves } = fixture({ statuses: [503, 503, 503] });
  changed(design(1));
  await advance(3_000);
  assert.equal(saves.length, 1);
  await advance(11_000);
  assert.equal(saves.length, 2, 'retried once');
  await advance(30_000);
  assert.equal(saves.length, 2, 'only once');
  changed(design(2));
  await advance(3_000);
  assert.equal(saves.length, 3);
  await advance(11_000);
  assert.equal(saves.length, 4, 'the next change gets its own retry');
  assert.deepEqual(saves.at(-1)?.group.variants, [{ variantId: '101', quantity: 2 }]);
});
