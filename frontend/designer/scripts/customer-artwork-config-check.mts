import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CustomerArtworkPublicViewSchema } from '@insignia/contracts';
import { validateGeometry } from '@insignia/visualizer/geometry';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'insignia-postorder-config-'));
after(() => rm(temporary, { recursive: true, force: true }));
async function moduleFor(file: string) {
  const result = await build({
    entryPoints: [new URL(`../src/${file}.ts`, import.meta.url).pathname],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  });
  const source = result.outputFiles[0];
  assert(source);
  const target = join(temporary, `${file.replace(/[^a-zA-Z0-9_-]/g, '_')}.mjs`);
  await writeFile(target, source.text);
  return import(pathToFileURL(target).href);
}
const artwork = (await moduleFor('customer-artwork-config')) as typeof import('../src/customer-artwork-config');
const model = (await moduleFor('model')) as typeof import('../src/model');
const slot = {
  groupIndex: 0,
  placementId: 'chest',
  productId: '111',
  revisionId: 'revision',
  methodId: 'print',
  stepId: 'chest:small',
};
function fixture() {
  return CustomerArtworkPublicViewSchema.parse({
    purchaseId: '11111111-1111-4111-8111-111111111111',
    expiresAt: '2027-01-01T00:00:00Z',
    artworkVersion: 0,
    slots: [slot],
    configurations: [
      {
        groupIndex: 0,
        productId: '111',
        revisionId: 'revision',
        contentHash: 'a'.repeat(64),
        variantIds: ['12', '13'],
        positions: [{ placementId: 'chest', position: { xMicros: 450000, yMicros: 500000 } }],
        slots: [slot],
        geometry: {
          version: 'm5-geometry-v1',
          views: [
            {
              id: 'front',
              image: { revisionId: 'blue', width: 1000, height: 1000 },
              variantImages: [{ variantId: '13', image: { revisionId: 'red', width: 1000, height: 1000 } }],
              placements: [
                {
                  id: 'chest',
                  rect: { centerX: 0.3, centerY: 0.4, width: 0.3, height: 0.3 },
                  variantOverrides: [
                    { variantId: '13', rect: { centerX: 0.7, centerY: 0.4, width: 0.25, height: 0.25 } },
                  ],
                },
              ],
            },
          ],
          steps: [
            { id: 'chest:small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } },
          ],
        },
        selectedSetup: {
          version: 'selected-product-setup-v1',
          methodBindings: {},
          product: {
            id: 'gid://shopify/Product/111',
            title: 'Shirt',
            images: [
              { id: 'blue', url: 'https://captured.test/blue.png', width: 1000, height: 1000, alt: 'Blue' },
              { id: 'red', url: 'https://captured.test/red.png', width: 1000, height: 1000, alt: 'Red' },
            ],
            methods: [{ id: 'print', name: 'Print', pricing: 'fixed', amount: '0' }],
            views: [
              {
                id: 'front',
                name: 'Front',
                imageUrl: 'https://captured.test/blue.png',
                imageWidth: 1000,
                imageHeight: 1000,
                placements: [
                  {
                    id: 'chest',
                    name: 'Chest',
                    rect: { centerX: 0.3, centerY: 0.4, width: 0.3, height: 0.3 },
                    widthCm: '',
                    heightCm: '',
                    methodIds: ['print'],
                    sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: {} }],
                    logoLaterAllowed: false,
                  },
                ],
              },
            ],
            variantPhotos: {
              options: [
                {
                  id: 'color',
                  name: 'Color',
                  values: [
                    { id: 'Blue', label: 'Blue' },
                    { id: 'Red', label: 'Red' },
                  ],
                },
              ],
              variants: [
                { id: 'gid://shopify/ProductVariant/12', label: 'Blue', optionValues: { color: 'Blue' } },
                { id: 'gid://shopify/ProductVariant/13', label: 'Red', optionValues: { color: 'Red' } },
              ],
              groupingOptionIds: ['color'],
              assignments: [],
            },
          },
        },
      },
    ],
  }).configurations[0]!;
}
test('post-order Designer shows actual purchased appearances with accepted physical size and final production centre', () => {
  const config = artwork.buildCustomerArtworkConfig(fixture(), 'USD', 'https://insignia.test');
  assert.equal(config.artworkOnly, true);
  assert.deepEqual(
    config.variantMatrix?.map((value) => value.variantId),
    ['12', '13'],
  );
  assert.deepEqual(config.positions[0]?.dimensions, [5]);
  const blue = config.colors.find((value) => value.name === 'Blue'),
    red = config.colors.find((value) => value.name === 'Red');
  assert(blue && red);
  const position = config.positions[0];
  assert(position);
  const view = config.views[0];
  assert(view);
  const blueModel = model.createProductModel(config, 'en', blue.id),
    redModel = model.createProductModel(config, 'en', red.id);
  assert.equal(blueModel.imageFor(blue.id, view.id), 'https://captured.test/blue.png');
  assert.equal(redModel.imageFor(red.id, view.id), 'https://captured.test/red.png');
  assert.equal(blueModel.positionFor(position.id).width, 15);
  assert.equal(redModel.positionFor(position.id).width, 12.5);
  assert.equal(blueModel.positionFor(position.id).x, 45);
  assert.equal(redModel.positionFor(position.id).x, 45);
  assert.equal(position.artworkLater, false);
});

test('canonical old-order upload-only projection renders exact accepted variant bounds and degrades missing photos without fictitious media', async () => {
  const canonical = (await moduleFor(
    '../../../apps/web/src/server/customer-artwork/canonical-presentation',
  )) as typeof import('../../../apps/web/src/server/customer-artwork/canonical-presentation.ts');
  const source = fixture(),
    geometry = validateGeometryForTest(source.geometry);
  geometry.steps[0]!.heightFraction = 0.25;
  const group = {
    variants: [
      { variantId: '12', quantity: 1 },
      { variantId: '13', quantity: 1 },
    ],
    design: {
      placements: [
        {
          placementId: 'chest',
          methodId: 'print',
          stepId: 'chest:small',
          artwork: { kind: 'deferred' as const, intentId: 'retained' },
          position: { xMicros: 450000, yMicros: 500000 },
        },
      ],
    },
  };
  const projection = canonical.canonicalCustomerArtworkPresentation({
    productId: '111',
    presentation: {
      version: 'm5-presentation-v1',
      labels: { placements: { chest: 'Chest' }, methods: { print: 'Print' }, steps: { 'chest:small': 'Small' } },
    },
    geometry,
    group,
    slots: [slot],
    imageUrls: {},
  });
  const config = artwork.buildCustomerArtworkConfig(
    { ...source, selectedSetup: undefined, ...projection },
    'USD',
    'https://insignia.test',
  );
  assert.equal(config.artworkOnly, true);
  assert.equal(config.previewUnavailable, true);
  assert.deepEqual(config.positions[0]?.dimensions, [5]);
  assert.equal(config.positions[0]?.x, 45);
  const blue = config.colors[0]!;
  const position = model.createProductModel(config, 'en', blue.id).positionFor(config.positions[0]!.id);
  assert.deepEqual(position.sizeBounds, [{ width: 15, maximumHeight: 7.5 }]);
  assert.deepEqual(blue.images, {});
});
function validateGeometryForTest(value: unknown): import('@insignia/visualizer/geometry').GeometryV1 {
  return validateGeometry(structuredClone(value) as Parameters<typeof validateGeometry>[0]);
}
