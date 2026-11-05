import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema, placementProductSchema, resolveVariantPhotoView } from '@insignia/contracts';
import { selectedProductFromConfig } from '../../src/islands/selected-product-view.ts';
import type { ConfigView } from '../../src/shared/admin-view.ts';

const image = { id: 'image_1', url: 'https://cdn.shopify.com/front.jpg', width: 1000, height: 1000, alt: 'Front' };
const saved = placementProductSchema.parse({
  id: 'gid://shopify/Product/111',
  title: 'Shirt',
  images: [image],
  methods: [],
  views: [{ id: 'front', name: 'Front', imageUrl: image.url, imageWidth: 1000, imageHeight: 1000, placements: [] }],
  variantPhotos: {
    options: [
      {
        id: 'colour',
        name: 'Colour',
        values: [
          { id: 'Blue', label: 'Blue' },
          { id: 'Red', label: 'Red' },
        ],
      },
    ],
    variants: [
      { id: 'gid://shopify/ProductVariant/1', optionValues: { colour: 'Blue' } },
      { id: 'gid://shopify/ProductVariant/2', optionValues: { colour: 'Red' } },
    ],
    groupingOptionIds: ['colour'],
    assignments: [
      { groupKey: '[["colour","Blue"]]', viewId: 'front', imageId: 'image_1' },
      { groupKey: '[["colour","Red"]]', viewId: 'front', imageId: 'image_1' },
    ],
  },
});
function view(): ConfigView {
  return {
    product: {
      id: saved.id,
      title: 'Current shirt',
      status: 'ACTIVE',
      imageUrl: image.url,
      images: [image],
      options: [{ id: 'colour', name: 'Colour', values: ['Blue', 'Green'] }],
      variants: [
        {
          id: 'gid://shopify/ProductVariant/1',
          title: 'Blue',
          imageUrl: null,
          selectedOptions: [{ name: 'Colour', value: 'Blue' }],
        },
        {
          id: 'gid://shopify/ProductVariant/3',
          title: 'Green',
          imageUrl: null,
          selectedOptions: [{ name: 'Colour', value: 'Green' }],
        },
      ],
    },
    config: {
      configId: 'cfg',
      installationGeneration: '1',
      draftVersion: '1',
      currentShopCurrency: 'USD',
      draft: MerchantDraftSchema.parse({
        version: 'm5-merchant-draft-v1',
        mode: 'required',
        shopCurrency: 'USD',
        methods: [],
        placements: [],
        productionOptions: [],
        pricingRules: [],
        geometry: { version: 'm5-geometry-v1', views: [], steps: [] },
        selectedSetup: { version: 'selected-product-setup-v1', product: saved, methodBindings: {} },
      }),
      publication: {
        state: 'DRAFT',
        revisionId: null,
        sourceDraftVersion: null,
        requestKey: null,
        reason: null,
        requiresAllChannelHold: null,
        functionReadiness: null,
      },
      publishEligibility: { allowed: false, reason: 'Incomplete' },
    },
  };
}
test('reloading current option metadata preserves valid photo assignments and requires review of removed appearances', () => {
  const product = selectedProductFromConfig(view());
  assert.deepEqual(
    product.variantPhotos?.options[0]?.values.map((v) => v.id),
    ['Blue', 'Green'],
  );
  assert.deepEqual(
    product.variantPhotos?.variants.map((v) => v.id),
    ['gid://shopify/ProductVariant/1', 'gid://shopify/ProductVariant/3'],
  );
  assert.deepEqual(product.variantPhotos?.assignments, [
    { groupKey: '[["colour","Blue"]]', viewId: 'front', imageId: 'image_1' },
  ]);
  assert.equal(product.views[0]?.needsAlignmentReview, true);
  assert.equal(product.title, 'Current shirt');
  assert.equal(saved.variantPhotos?.assignments.length, 2, 'Frozen source is unchanged');
});
test('truncated variant metadata cannot silently discard an existing authoring matrix', () => {
  const current = view();
  current.product.variantsTruncated = true;
  assert.throws(() => selectedProductFromConfig(current), /variant/i);
});
test('retained production choices and their saved labels survive selected authoring projection', () => {
  const current = view();
  if (!current.config) throw new Error('fixture');
  const prior = MerchantDraftSchema.parse(current.config.draft);
  current.config.draft = {
    ...prior,
    productionOptions: [{ id: 'thread', allowedValueIds: ['blue', 'red'] }],
    labels: { options: { thread: 'Thread colour' }, values: { thread: { blue: 'Blue', red: 'Red' } } },
  };
  const projected = selectedProductFromConfig(current);
  assert.deepEqual(projected.productionChoices, {
    definitions: [{ id: 'thread', allowedValueIds: ['blue', 'red'] }],
    labels: { options: { thread: 'Thread colour' }, values: { thread: { blue: 'Blue', red: 'Red' } } },
  });
});
test('older asymmetric decoration fractions remain distinct in selected authoring', () => {
  const current = view();
  if (!current.config) throw new Error('fixture');
  current.config.draft = MerchantDraftSchema.parse({
    version: 'm5-merchant-draft-v1',
    mode: 'required',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [{ id: 'chest', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'image_1', width: 1000, height: 1000 },
          variantImages: [],
          placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.25, physicalMm: { width: 100, height: 50 } }],
    },
  });
  const selected = selectedProductFromConfig(current),
    size = selected.views[0]?.placements[0]?.sizes[0];
  assert.equal(size?.widthPercent, '50');
  assert.equal(size && 'heightPercent' in size ? size.heightPercent : undefined, '25');
});

test('ambiguous or unsupported historical price components cannot silently change on first selected save', () => {
  const price = {
    id: 'price',
    role: 'unit',
    scope: { kind: 'step', placementId: 'chest', stepId: 'small', methodId: 'print' },
    rate: { kind: 'fixed', amount: { shopDecimal: '3.50', presentmentOverrides: [] } },
  };
  for (const rules of [
    [price, { ...price, id: 'extra' }],
    [{ ...price, methodUnitMultiplicity: 'perPlacement' }],
    [{ ...price, scope: { kind: 'step', placementId: 'chest', stepId: 'small' } }],
    [{ ...price, rate: { kind: 'fixed', amount: { shopDecimal: '-1.00', presentmentOverrides: [] } } }],
  ]) {
    const current = view();
    if (!current.config) throw new Error('fixture');
    const draft = MerchantDraftSchema.parse(current.config.draft);
    delete draft.selectedSetup;
    draft.methods = [{ id: 'print' }];
    draft.placements = [
      { id: 'chest', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
    ];
    draft.geometry = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'image_1', width: 1000, height: 1000 },
          variantImages: [],
          placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 100, height: 100 } }],
    };
    draft.pricingRules = MerchantDraftSchema.shape.pricingRules.parse(rules);
    current.config.draft = draft;
    assert.throws(() => selectedProductFromConfig(current), /historical pricing/i);
    assert.deepEqual(MerchantDraftSchema.parse(current.config.draft).pricingRules, rules);
  }
});

test('first selected load retains the actual variant photo and placement alignment of an older draft', () => {
  const current = view();
  assert.ok(current.config);
  current.product.options = [{ id: 'gid://shopify/ProductOption/10', name: 'Colour', values: ['Blue', 'Green'] }];
  current.product.imagesTruncated = false;
  current.product.variantsTruncated = false;
  const variantImage = { ...image, id: 'image_2', url: 'https://cdn.shopify.com/green.jpg' };
  current.product.images = [image, variantImage];
  const rect = { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 };
  current.config.draft = MerchantDraftSchema.parse({
    version: 'm5-merchant-draft-v1',
    mode: 'required',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [{ id: 'chest', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'image_1', width: 1000, height: 1000 },
          variantImages: [{ variantId: 'variant_3', image: { revisionId: 'image_2', width: 1000, height: 1000 } }],
          placements: [
            {
              id: 'chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
              variantOverrides: [{ variantId: '3', rect }],
            },
          ],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.25, physicalMm: { width: 100, height: 50 } }],
    },
  });
  const product = selectedProductFromConfig(current);
  const resolved = resolveVariantPhotoView(product, 'front', '[["gid://shopify/ProductOption/10","Green"]]');
  assert.equal(resolved.status, 'ready');
  if (resolved.status !== 'ready') throw new Error('Expected actual variant appearance');
  assert.equal(resolved.view.imageUrl, variantImage.url);
  assert.deepEqual(resolved.view.placements[0]?.rect, rect);
  assert.equal(product.views[0]?.placements[0]?.heightCm, '20');
});
