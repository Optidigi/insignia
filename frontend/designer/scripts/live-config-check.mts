import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'insignia-live-config-'));
after(() => rm(temporary, { recursive: true, force: true }));

import { build } from 'esbuild';

async function moduleFor(file: string) {
  const result = await build({
    entryPoints: [new URL(`../src/${file}`, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const first = result.outputFiles[0];
  if (!first) throw new Error('Missing module');
  const output = join(temporary, file.replace(/[^a-zA-Z0-9_-]/g, '_') + '.mjs');
  await writeFile(output, first.text);
  return import(pathToFileURL(output).href);
}
const live = (await moduleFor('live-config.ts')) as typeof import('../src/live-config');
const models = (await moduleFor('model.ts')) as typeof import('../src/model');
const quote = (await moduleFor('quote-review.ts')) as typeof import('../src/quote-review');
function fixture(): import('../src/live-config').PublishedDesignerSource {
  return {
    productId: '11',
    options: [],
    revisionId: 'rev-one',
    contentHash: 'a'.repeat(64),
    shopCurrency: 'EUR',
    title: 'Shirt',
    selectedSetup: {
      version: 'selected-product-setup-v1',
      methodBindings: {},
      product: {
        id: '11',
        title: 'Shirt',
        images: [
          { id: 'photo', url: 'https://assets.example.test/frozen.png', width: 1000, height: 1000, alt: 'Shirt' },
        ],
        methods: [{ id: 'print:one', name: 'Print', pricing: 'fixed', amount: '3.50' }],
        views: [
          {
            id: 'view:front',
            name: 'Front',
            imageUrl: 'https://assets.example.test/frozen.png',
            imageWidth: 1000,
            imageHeight: 1000,
            placements: [
              {
                id: 'front:chest',
                name: 'Chest',
                rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
                widthCm: '20',
                heightCm: '20',
                methodIds: ['print:one'],
                sizes: [{ id: 'size:small', name: 'Small', widthPercent: '50', prices: {} }],
                logoLaterAllowed: true,
                customPlacementAllowed: true,
                movementRect: { centerX: 0.5, centerY: 0.5, width: 0.6, height: 0.6 },
              },
            ],
          },
        ],
      },
    },
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'view:front',
          image: { revisionId: 'photo', width: 1000, height: 1000 },
          variantImages: [],
          placements: [{ id: 'front:chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 } }],
        },
      ],
      steps: [
        {
          id: 'front:chest:size:small',
          widthFraction: 0.5,
          heightFraction: 0.5,
          physicalMm: { width: 100, height: 100 },
        },
      ],
    },
    imageUrls: { photo: 'https://assets.example.test/frozen.png' },
    placements: [{ id: 'front:chest', allowedStepIds: ['front:chest:size:small'] }],
    variants: [
      {
        id: '101',
        label: 'Blue / S',
        available: true,
        selectedOptions: [
          { name: 'Color', value: 'Blue' },
          { name: 'Size', value: 'S' },
        ],
        baseUnitMinor: '2000',
      },
      {
        id: '102',
        label: 'Blue / L',
        available: true,
        selectedOptions: [
          { name: 'Color', value: 'Blue' },
          { name: 'Size', value: 'L' },
        ],
        baseUnitMinor: '2500',
      },
    ],
    decorationPrices: [
      { placementId: 'front:chest', methodId: 'print:one', stepId: 'front:chest:size:small', minor: '350' },
    ],
  };
}
test('real Designer mapping uses stable reversible identities, real sparse Shopify tuples and exact publication prices', () => {
  const mapped = live.buildPublishedDesigner(fixture(), { locale: 'nl-NL', storeName: 'Store' });
  const position = mapped.config.positions[0];
  assert(position);
  assert.match(position.id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(position.id, live.designerAlias('front:chest'));
  assert.equal(position.methodSizePrices?.[live.designerAlias('print:one')]?.[0], 350);
  assert.deepEqual(position.dimensions, [10], 'calibrated100mm is displayed as10cm, never50percent as50cm');
  assert.deepEqual(
    mapped.config.variantMatrix?.map((cell) => cell.variantId),
    ['101', '102'],
  );
  const desired = mapped.desired({
    id: 'design-one',
    prints: [
      {
        id: position.id,
        method: live.designerAlias('print:one'),
        size: 0,
        artworkId: 'later',
        position: { x: 52, y: 48 },
      },
    ],
    quantities: {},
    variants: [{ variantId: '101', quantity: 2 }],
  });
  assert.equal(desired.design.placements[0]?.placementId, 'front:chest');
  assert.equal(desired.design.placements[0]?.stepId, 'front:chest:size:small');
  assert.deepEqual(desired.design.placements[0]?.position, { xMicros: 520000, yMicros: 480000 });
});
test('differing variant base prices produce the actual total while old demo configs retain their price model', () => {
  const mapped = live.buildPublishedDesigner(fixture(), { locale: 'en', storeName: 'Store' });
  const model = models.createProductModel(mapped.config);
  const position = mapped.config.positions[0];
  assert(position);
  const prints = [{ id: position.id, method: position.methodIds[0]!, size: 0, artworkId: 'later' }];
  const quantities = Object.fromEntries(
    mapped.config.variantMatrix!.map((cell, index) => [`${cell.rowId}:${cell.columnId}`, index + 1]),
  );
  assert.equal(model.totalPrice(prints, quantities), 2350 + 2850 * 2);
  assert.deepEqual(model.basePriceRange(quantities), [2000, 2500]);
  const malformed = fixture();
  malformed.variants[0]!.baseUnitMinor = '9007199254740992';
  assert.throws(() => live.buildPublishedDesigner(malformed, { locale: 'en', storeName: 'Store' }), /display amount/);
});
test('quote review formatting keeps exact cents beyond numeric precision', () => {
  const formatted = quote.quoteReviewMoney('900719925474099199', 'EUR', 2, 'en-US');
  assert.equal(formatted, '€9,007,199,254,740,991.99');
});

test('merchant variant photo groups choose real row axes, captured photos and aligned placement geometry', () => {
  const source = fixture();
  assert(source.selectedSetup);
  const product = source.selectedSetup.product;
  product.images.push(
    { id: 'small-photo', url: 'https://assets.example.test/small.png', width: 1000, height: 1000, alt: 'Small' },
    { id: 'large-photo', url: 'https://assets.example.test/large.png', width: 1000, height: 1000, alt: 'Large' },
  );
  product.variantPhotos = {
    options: [
      {
        id: 'size-option',
        name: 'Size',
        values: [
          { id: 'small', label: 'S' },
          { id: 'large', label: 'L' },
        ],
      },
    ],
    variants: [
      { id: '101', optionValues: { 'size-option': 'small' } },
      { id: '102', optionValues: { 'size-option': 'large' } },
    ],
    groupingOptionIds: ['size-option'],
    assignments: [],
  };
  source.geometry = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'view:front',
        image: { revisionId: 'photo', width: 1000, height: 1000 },
        variantImages: [
          { variantId: '101', image: { revisionId: 'small-photo', width: 1000, height: 1000 } },
          { variantId: '102', image: { revisionId: 'large-photo', width: 1000, height: 1000 } },
        ],
        placements: [
          {
            id: 'front:chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
            variantOverrides: [{ variantId: '102', rect: { centerX: 0.6, centerY: 0.5, width: 0.2, height: 0.2 } }],
          },
        ],
      },
    ],
    steps: [
      {
        id: 'front:chest:size:small',
        widthFraction: 0.5,
        heightFraction: 0.5,
        physicalMm: { width: 100, height: 100 },
      },
    ],
  };
  source.imageUrls = {
    photo: 'https://captured.example.test/shared.png',
    'small-photo': 'https://captured.example.test/small.png',
    'large-photo': 'https://captured.example.test/large.png',
  };
  const mapped = live.buildPublishedDesigner(source, { locale: 'en', storeName: 'Store' });
  assert.equal(mapped.config.optionPresentation?.rowOption.label, 'Size');
  const large = mapped.config.colors.find((row) => row.name === 'L');
  assert(large);
  const model = models.createProductModel(mapped.config, 'en', large.id);
  assert.equal(model.imageFor(large.id, live.designerAlias('view:front')), 'https://captured.example.test/large.png');
  assert.equal(model.positionFor(live.designerAlias('front:chest')).x, 60);
  assert.equal(model.positionFor(live.designerAlias('front:chest')).width, 10);
});

test('deferred placement identity is stable and independent, and original identities survive new editing sessions', () => {
  const source = fixture();
  const placement = source.selectedSetup!.product.views[0]!.placements[0]!;
  source.selectedSetup!.product.views[0]!.placements.push({ ...placement, id: 'back', name: 'Back' });
  source.placements.push({ id: 'back', allowedStepIds: ['back:small'] });
  source.geometry!.views[0]!.placements.push({ ...source.geometry!.views[0]!.placements[0]!, id: 'back' });
  source.geometry!.steps.push({
    id: 'back:small',
    widthFraction: 0.5,
    heightFraction: 0.25,
    physicalMm: { width: 50, height: 25 },
  });
  source.selectedSetup!.product.views[0]!.placements[1]!.sizes = [
    { id: 'small', name: 'Small', widthPercent: '50', heightPercent: '25', prices: {} },
  ];
  source.decorationPrices!.push({ placementId: 'back', methodId: 'print:one', stepId: 'back:small', minor: '350' });
  const mapped = live.buildPublishedDesigner(source, { locale: 'en', storeName: 'Store' });
  const design = {
    id: 'new-design',
    prints: mapped.config.positions.map((position) => ({
      id: position.id,
      method: position.methodIds[0]!,
      size: 0,
      artworkId: 'later',
    })),
    quantities: {},
    variants: [{ variantId: '101', quantity: 1 }],
  };
  const first = mapped.desired(design),
    retry = mapped.desired(design);
  assert.deepEqual(first, retry);
  const intents = first.design.placements.map((placement) =>
    placement.artwork.kind === 'deferred' ? placement.artwork.intentId : '',
  );
  assert.equal(new Set(intents).size, 2);
  assert(intents.every((id) => id.length <= 128));
  const original = structuredClone(first);
  original.design.placements[0]!.artwork = { kind: 'deferred', intentId: 'original-intent' };
  const restored = mapped.restore(original, 'different-editor-session');
  assert.deepEqual(mapped.desired(restored).design, original.design);
});
