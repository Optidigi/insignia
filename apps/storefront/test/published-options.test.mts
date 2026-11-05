import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { BuyerConfig } from '../src/buyer.ts';

const compiled = await build({
    entryPoints: [new URL('../src/designer/published.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  }),
  output = compiled.outputFiles[0];
assert(output);
const directory = await mkdtemp(join(tmpdir(), 'insignia-canonical-'));
await writeFile(join(directory, 'published.mjs'), output.text);
const { buildBuyerDesigner } = (await import(
  pathToFileURL(join(directory, 'published.mjs')).href
)) as typeof import('../src/designer/published.ts');
await rm(directory, { recursive: true, force: true });
function fixture(): BuyerConfig {
  return {
    version: 'm7-config-v1',
    productId: '111',
    revisionId: 'revision',
    contentHash: 'a'.repeat(64),
    methods: [{ id: 'print', label: 'Print' }],
    placements: [
      { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
    ],
    steps: [{ id: 'small', label: 'Small' }],
    options: [
      {
        id: 'packing',
        label: 'Packaging',
        values: [
          { id: 'plain', label: 'Plain' },
          { id: 'gift', label: 'Gift wrap' },
        ],
      },
    ],
    variants: [
      {
        id: '222',
        label: 'Blue / M',
        available: true,
        selectedOptions: [
          { name: 'Color', value: 'Blue' },
          { name: 'Size', value: 'M' },
        ],
        baseUnitMinor: '2000',
      },
    ],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'photo', width: 1000, height: 1000 },
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } }],
    },
    imageUrls: { photo: 'https://example.test/photo.png' },
    ready: true,
    title: 'Shirt',
    shopCurrency: 'USD',
    decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '350' }],
  };
}
test('older Lean publication uses actual retained facts in new Designer and preserves production choices exactly', () => {
  const source = fixture(),
    mapped = buildBuyerDesigner(source, { locale: 'en', storeName: 'Store' });
  assert.equal(mapped.config.positions[0]?.dimensions[0], 5);
  assert.equal(mapped.config.productionOptions?.[0]?.label, 'Packaging');
  const saved = {
    productId: '111',
    configRevisionId: 'old',
    revisionContentHash: 'b'.repeat(64),
    design: {
      placements: [
        {
          placementId: 'front',
          methodId: 'print',
          stepId: 'small',
          artwork: { kind: 'deferred' as const, intentId: 'old-intent' },
        },
      ],
      options: [{ optionId: 'packing', valueId: 'gift' }],
    },
    variants: [{ variantId: '222', quantity: 2 }],
  };
  const restored = mapped.restore(saved, 'owned-design');
  const desired = mapped.desired(restored);
  assert.deepEqual(desired.design.options, saved.design.options);
  assert.deepEqual(desired.variants, saved.variants);
  assert.equal(desired.design.placements[0]?.stepId, 'small');
  assert.equal(desired.configRevisionId, 'revision');
  const renamed = fixture();
  renamed.variants[0]!.label = 'New label';
  assert.equal(
    buildBuyerDesigner(renamed, { locale: 'en', storeName: 'Store' }).config.colors[0]?.id,
    mapped.config.colors[0]?.id,
    'variant identity survives label edits',
  );
  assert.throws(
    () =>
      mapped.restore(
        { ...saved, design: { ...saved.design, options: [{ optionId: 'packing', valueId: 'removed' }] } },
        'owned-design',
      ),
    /no longer available/,
  );
});
test('missing or ambiguous critical canonical financial/production facts cannot create editable defaults', () => {
  for (const change of [
    (value: BuyerConfig) => delete value.shopCurrency,
    (value: BuyerConfig) => delete value.decorationPrices,
    (value: BuyerConfig) => {
      delete value.geometry.steps[0]!.physicalMm;
    },
    (value: BuyerConfig) => {
      value.decorationPrices!.push({ ...value.decorationPrices![0]! });
    },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => buildBuyerDesigner(value, { locale: 'en', storeName: 'Store' }));
  }
});

test('asymmetric retained sizes, tiny geometry and missing optional previews retain exact editable production facts', () => {
  const source = fixture();
  source.imageUrls = {};
  source.geometry.steps[0]!.heightFraction = 0.25;
  source.geometry.views[0]!.placements[0]!.rect.width = 0.01;
  const mapped = buildBuyerDesigner(source, { locale: 'en', storeName: 'Store' });
  assert.equal(mapped.config.previewUnavailable, true);
  assert.deepEqual(mapped.config.positions[0]?.sizeBounds, [{ width: 0.5, maximumHeight: 7.5 }]);
  assert.deepEqual(mapped.config.colors[0]?.images, {});
  assert.deepEqual(mapped.config.positions[0]?.dimensions, [5]);
});
