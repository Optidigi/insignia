import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { CartRequest } from '../../../frontend/designer/src/runtime.ts';
import type { BuyerConfig, DesiredGroup } from '../src/buyer.ts';
import { lineCarriers, requestUrl } from './support.mts';

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
const temporary = await mkdtemp(join(tmpdir(), 'insignia-cart-capacity-'));
const moduleFile = join(temporary, 'ports.mjs');
await writeFile(moduleFile, bundle.outputFiles[0]!.text);
after(() => rm(temporary, { recursive: true, force: true }));
const { createLiveDesignerPorts, designerAlias } = (await import(
  pathToFileURL(moduleFile).href
)) as typeof import('../src/designer/live-ports.ts') & typeof import('../../../frontend/designer/src/live-config.ts');

const size = (id: string, value: string) => ({
  id,
  label: value,
  available: true,
  selectedOptions: [{ name: 'Size', value }],
  baseUnitMinor: '1000',
});
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
  variants: [size('101', 'S'), size('102', 'M')],
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
/** A design already in the cart, as the server rebuilds it from the observed signed lines. */
const retained = (entries: number, quantity = 1): DesiredGroup => ({
  productId: '111',
  configRevisionId: source.revisionId,
  revisionContentHash: source.contentHash,
  design: {
    placements: [
      { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: 'other' } },
    ],
    options: [],
  },
  variants: Array.from({ length: entries }, (_, index) => ({ variantId: String(900 + index), quantity })),
});

function fixture(cartGroups: DesiredGroup[]) {
  const routes: string[] = [];
  const values = new Map<string, string>();
  const carrier = lineCarriers([{ variantId: '900', unitMinor: '1500' }]).carriers[0] ?? '';
  const items = cartGroups.length
    ? [{ key: 'line-0', variant_id: 900, quantity: 1, properties: { _insignia_line_v3: carrier } }]
    : [];
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
    fetchImpl: async (url, init = {}) => {
      const path = new URL(requestUrl(url), 'https://fixture.test').pathname;
      routes.push(path.split('/').at(-1) ?? path);
      if (path.endsWith('/sessions'))
        return Response.json({
          capability: 'abc.def',
          sessionId: '11111111-1111-4111-8111-111111111111',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
      if (path.endsWith('/config')) return Response.json(source);
      if (path.endsWith('/cart-state')) return Response.json({ groups: cartGroups, repairRequired: false });
      if (/\/designs\/[^/]+$/.test(path))
        return Response.json({ id: path.split('/').at(-1), version: 1, value: JSON.parse(String(init.body)).group });
      if (path.endsWith('/quote-proposals'))
        return Response.json({
          proposalId: '11111111-1111-4111-8111-000000000001',
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
      return Response.json({ items, attributes: {}, currency: 'USD' });
    },
  });
  return { live, routes };
}
const request = (variants: { variantId: string; quantity: number }[]): CartRequest => ({
  requestId: 'request',
  idempotencyKey: crypto.randomUUID(),
  operation: 'added',
  artworks: [],
  signal: new AbortController().signal,
  design: {
    id: crypto.randomUUID(),
    options: [],
    prints: [{ id: designerAlias('front'), artworkId: 'later', size: 0, method: designerAlias('print') }],
    quantities: {},
    variants,
  },
});

for (const [name, cart, variants] of [
  [
    'one design with two sizes of 6,000 garments',
    [],
    [
      { variantId: '101', quantity: 6000 },
      { variantId: '102', quantity: 6000 },
    ],
  ],
  [
    '31 retained variant entries plus two new sizes',
    [retained(31)],
    [
      { variantId: '101', quantity: 1 },
      { variantId: '102', quantity: 1 },
    ],
  ],
  ['9,999 retained garments plus two more', [retained(1, 9999)], [{ variantId: '101', quantity: 2 }]],
] as const) {
  test(`the Designer reports the cart limit instead of proposing: ${name} (#335)`, async () => {
    const app = fixture([...cart]);
    await assert.rejects(app.live.ports.review!.prepare(request([...variants])), { code: 'CAPACITY_EXCEEDED' });
    assert.equal(app.routes.includes('quote-proposals'), false, 'an over-capacity cart is never sent');
  });
}

test('a cart at exactly 32 variant entries and 10,000 garments is still proposed (#335)', async () => {
  const app = fixture([retained(30, 333)]);
  await app.live.ports.review!.prepare(
    request([
      { variantId: '101', quantity: 5 },
      { variantId: '102', quantity: 5 },
    ]),
  );
  assert.equal(app.routes.includes('quote-proposals'), true);
});
