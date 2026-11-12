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
const design = (quantity: number, x = 50): Design => ({
  id: DESIGN_ID,
  options: [],
  prints: [
    { id: designerAlias('front'), artworkId: 'later', size: 0, method: designerAlias('print'), position: { x, y: 50 } },
  ],
  quantities: {},
  variants: quantity ? [{ variantId: '101', quantity }] : [],
});

function fixture(options: { saveStatus?: number } = {}) {
  const saves: { expectedVersion: number; group: { variants: unknown[] } }[] = [];
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
  return { live, saves, changed };
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
  assert.ok(saves.length <= 14, `${saves.length} draft writes in 70 seconds`);
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
