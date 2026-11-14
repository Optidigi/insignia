import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema, resolveVariantPhotoView, SelectedProductSetupSchema } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import { selectedProductFromConfig } from '../../../../frontend/admin/src/islands/selected-product-view.ts';
import { selectedProductDraft, selectedPublicationProblems } from '../../src/server/selected-product.ts';
import type { ConfigView } from '../../src/shared/admin-view.ts';

const previous = MerchantDraftSchema.parse({
  version: 'm5-merchant-draft-v1',
  mode: 'optional',
  shopCurrency: 'USD',
  methods: [],
  placements: [],
  productionOptions: [],
  pricingRules: [],
  geometry: { version: 'm5-geometry-v1', views: [{ id: 'front', placements: [], variantImages: [] }], steps: [] },
});
const setup = SelectedProductSetupSchema.parse({
  version: 'selected-product-setup-v1',
  methodBindings: {},
  product: {
    id: 'gid://shopify/Product/111',
    title: 'T-shirt',
    images: [{ id: 'product_111', url: 'https://cdn.shopify.com/front.jpg', width: 1000, height: 1200, alt: 'Front' }],
    methods: [
      { id: 'print', name: 'Print', pricing: 'fixed', amount: '3.50' },
      { id: 'stitch', name: 'Stitch', pricing: 'product', amount: '' },
    ],
    views: [
      {
        id: 'front',
        name: 'Front',
        imageUrl: 'https://cdn.shopify.com/front.jpg',
        imageWidth: 1000,
        imageHeight: 1200,
        calibration: {
          imageUrl: 'https://cdn.shopify.com/front.jpg',
          imageWidth: 1000,
          imageHeight: 1200,
          a: { x: 0.2, y: 0.5 },
          b: { x: 0.8, y: 0.5 },
          distanceCm: 30,
        },
        placements: [
          {
            id: 'chest',
            name: 'Chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            widthCm: '10',
            heightCm: '12',
            methodIds: ['print', 'stitch'],
            logoLaterAllowed: true,
            sizes: [
              { id: 'small', name: 'Small', widthPercent: '50', prices: { stitch: '0' } },
              { id: 'large', name: 'Large', widthPercent: '100', prices: {} },
            ],
          },
        ],
      },
    ],
  },
});
test('selected setup persists actual physical sizes and final prices without treating missing as free or adding defaults twice', () => {
  const draft = selectedProductDraft(setup, previous);
  assert.equal(draft.mode, 'required');
  assert.deepEqual(draft.selectedSetup, setup);
  assert.deepEqual(
    draft.pricingRules.map((rule) => rule.rate.kind === 'fixed' && rule.rate.amount.shopDecimal),
    ['3.50', '0', '3.50'],
  );
  assert.deepEqual((draft.geometry as { steps: unknown[] }).steps, [
    { id: 'chest:small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 60 } },
    { id: 'chest:large', widthFraction: 1, heightFraction: 1, physicalMm: { width: 100, height: 120 } },
  ]);
  assert.deepEqual(selectedPublicationProblems(draft), []);
});

test('a featured photo that Shopify also lists as media validates under either identity, so the editor may show it once', () => {
  const url = 'https://cdn.shopify.com/front.jpg';
  assert.equal(setup.product.images[0]?.url, url);
  const catalog = {
    id: setup.product.id,
    title: setup.product.title,
    status: 'ACTIVE' as const,
    imageUrl: url,
    images: [
      { id: 'product_111', url, width: 1000, height: 1200, alt: 'Front' },
      { id: 'image_9', url, width: 1000, height: 1200, alt: 'Front' },
    ],
    variants: [],
    variantsTruncated: false,
  };
  // An existing draft keeps resolving through the featured identity it saved.
  assert.deepEqual(selectedPublicationProblems(selectedProductDraft(setup, previous), catalog), []);
  // A draft saved after the editor de-duplicated the picker references the stable media identity.
  const deduplicated = structuredClone(setup);
  deduplicated.product.images = [{ id: 'image_9', url, width: 1000, height: 1200, alt: 'Front' }];
  const saved = selectedProductDraft(deduplicated, previous);
  assert.equal(
    (saved.geometry as { views: { image: { revisionId: string } }[] }).views[0]?.image.revisionId,
    'image_9',
  );
  assert.deepEqual(selectedPublicationProblems(saved, catalog), []);
});

test('a legacy uncalibrated draft keeps its production dimensions through the de-duplicated editor and a price-only save', () => {
  const url = 'https://cdn.shopify.com/front.jpg';
  const legacy = MerchantDraftSchema.parse({
    ...previous,
    methods: [{ id: 'print' }],
    placements: [{ id: 'chest', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'product_111', width: 1000, height: 1200 },
          variantImages: [],
          placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 72, height: 91 } }],
    },
  });
  const view: ConfigView = {
    product: {
      id: 'gid://shopify/Product/111',
      title: 'T-shirt',
      status: 'ACTIVE',
      imageUrl: url,
      images: [
        { id: 'product_111', url, width: 1000, height: 1200, alt: 'Front' },
        { id: 'image_9', url, width: 1000, height: 1200, alt: 'Front' },
      ],
      variants: [],
      variantsTruncated: false,
    },
    config: {
      configId: 'cfg',
      installationGeneration: '1',
      draftVersion: '1',
      currentShopCurrency: 'USD',
      draft: legacy,
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
  const product = selectedProductFromConfig(view);
  const saved = selectedProductDraft(
    SelectedProductSetupSchema.parse({ version: 'selected-product-setup-v1', product, methodBindings: {} }),
    legacy,
  );
  assert.deepEqual((saved.geometry as GeometryV1).steps[0]?.physicalMm, { width: 72, height: 91 });
  assert.deepEqual(
    product.images.map((image) => image.id),
    ['product_111'],
  );
});

test('price-only adoption retains exact known production dimensions without inventing image calibration', () => {
  const old = MerchantDraftSchema.parse({
    ...previous,
    methods: [{ id: 'print' }],
    placements: [
      { id: 'chest', allowedMethodIds: ['print'], allowedStepIds: ['small', 'large'], logoLaterAllowed: true },
    ],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'product_111', width: 1000, height: 1200 },
          variantImages: [],
          placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
        },
      ],
      steps: [
        { id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 72, height: 91 } },
        { id: 'large', widthFraction: 1, heightFraction: 1, physicalMm: { width: 144, height: 182 } },
      ],
    },
  });
  const input = structuredClone(setup);
  delete input.product.views[0]!.calibration;
  input.product.methods[0]!.amount = '4.25';
  const adopted = selectedProductDraft(input, old);
  assert.deepEqual(
    (adopted.geometry as GeometryV1).steps.map((step) => step.physicalMm),
    [
      { width: 72, height: 91 },
      { width: 144, height: 182 },
    ],
  );
  assert.equal(adopted.selectedSetup?.product.views[0]?.calibration, undefined);
  input.product.views[0]!.placements[0]!.rect.width = 0.3;
  assert.ok(
    (selectedProductDraft(input, old).geometry as GeometryV1).steps.every((step) => !step.physicalMm),
    'Changed placement requires actual calibration',
  );
  input.product.views[0]!.placements[0]!.rect.width = 0.2;
  input.product.views[0]!.placements[0]!.sizes[0]!.widthPercent = '25';
  assert.equal(
    (selectedProductDraft(input, old).geometry as GeometryV1).steps[0]?.physicalMm,
    undefined,
    'Changed scale cannot borrow the old dimensions',
  );
});
test('empty selected drafts can be saved but cannot authorize publication', () => {
  const empty = SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: { id: setup.product.id, title: 'T-shirt', images: [], views: [], methods: [] },
  });
  const draft = selectedProductDraft(empty, previous);
  assert.equal(draft.selectedSetup?.product.views.length, 0);
  assert.ok(selectedPublicationProblems(draft).length > 0);
});
test('price precision is never rounded and unowned image references cannot be projected', () => {
  const changed = structuredClone(setup);
  changed.product.methods[0]!.amount = '3.501';
  assert.throws(() => selectedProductDraft(changed, previous));
  changed.product.methods[0]!.amount = '3.50';
  changed.product.views[0]!.imageUrl = 'https://attacker.invalid/arbitrary.jpg';
  assert.throws(() => selectedProductDraft(changed, previous));
});

function groupedSetup() {
  const value = structuredClone(setup);
  value.product.images.push({
    id: 'image_222',
    url: 'https://cdn.shopify.com/blue.jpg',
    width: 800,
    height: 1000,
    alt: 'Blue',
  });
  value.product.variantPhotos = {
    options: [
      {
        id: 'gid://shopify/ProductOption/10',
        name: 'Color',
        values: [
          { id: 'Red', label: 'Red' },
          { id: 'Blue', label: 'Blue' },
        ],
      },
    ],
    variants: [
      { id: 'gid://shopify/ProductVariant/201', optionValues: { 'gid://shopify/ProductOption/10': 'Red' } },
      { id: 'gid://shopify/ProductVariant/202', optionValues: { 'gid://shopify/ProductOption/10': 'Blue' } },
    ],
    groupingOptionIds: ['gid://shopify/ProductOption/10'],
    assignments: [
      { groupKey: '[["gid://shopify/ProductOption/10","Red"]]', viewId: 'front', useShared: true },
      {
        groupKey: '[["gid://shopify/ProductOption/10","Blue"]]',
        viewId: 'front',
        imageId: 'image_222',
        placementRects: { chest: { centerX: 0.4, centerY: 0.6, width: 0.3, height: 0.25 } },
      },
    ],
  };
  return value;
}
test('active photo grouping projects exact image and rectangle overrides while shared image and physical production sizes stay fixed', () => {
  const draft = selectedProductDraft(groupedSetup(), previous);
  const geometry = draft.geometry as {
    views: { image: unknown; variantImages: unknown[]; placements: unknown[] }[];
    steps: unknown[];
  };
  assert.deepEqual(geometry.views[0]!.image, { revisionId: 'product_111', width: 1000, height: 1200 });
  assert.deepEqual(geometry.views[0]!.variantImages, [
    { variantId: 'variant_202', image: { revisionId: 'image_222', width: 800, height: 1000 } },
  ]);
  assert.deepEqual(geometry.views[0]!.placements, [
    {
      id: 'chest',
      rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
      variantOverrides: [{ variantId: 'variant_202', rect: { centerX: 0.4, centerY: 0.6, width: 0.3, height: 0.25 } }],
    },
  ]);
  assert.deepEqual(geometry.steps, (selectedProductDraft(setup, previous).geometry as { steps: unknown[] }).steps);
});

test('publication requires every active appearance image and alignment, including transformed movement bounds', () => {
  const value = groupedSetup();
  value.product.variantPhotos!.assignments.pop();
  assert.match(selectedPublicationProblems(selectedProductDraft(value, previous)).join(' '), /image.*Blue/i);
  const aligned = groupedSetup();
  aligned.product.variantPhotos!.assignments[1]!.needsAlignmentReview = true;
  assert.match(selectedPublicationProblems(selectedProductDraft(aligned, previous)).join(' '), /alignment.*Blue/i);
  delete aligned.product.variantPhotos!.assignments[1]!.needsAlignmentReview;
  aligned.product.views[0]!.placements[0]!.customPlacementAllowed = true;
  aligned.product.views[0]!.placements[0]!.movementRect = { centerX: 0.5, centerY: 0.5, width: 0.8, height: 0.8 };
  assert.match(selectedPublicationProblems(selectedProductDraft(aligned, previous)).join(' '), /alignment.*Blue/i);
});

function currentCatalogue(): import('../../src/shared/admin-view.ts').CatalogProduct {
  const value = groupedSetup().product;
  return {
    id: value.id,
    title: value.title,
    status: 'ACTIVE',
    imageUrl: value.images[0]!.url,
    images: value.images,
    variantsTruncated: false,
    options: [{ id: 'gid://shopify/ProductOption/10', name: 'Color', values: ['Red', 'Blue'] }],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/201',
        title: 'Red',
        imageUrl: value.images[0]!.url,
        selectedOptions: [{ name: 'Color', value: 'Red' }],
      },
      {
        id: 'gid://shopify/ProductVariant/202',
        title: 'Blue',
        imageUrl: value.images[1]!.url,
        selectedOptions: [{ name: 'Color', value: 'Blue' }],
      },
    ],
  };
}
test('publication reconciles all authoring options, actual variants and referenced photos against fresh product-owned catalogue data', () => {
  const value = groupedSetup();
  assert.deepEqual(selectedPublicationProblems(selectedProductDraft(value, previous), currentCatalogue()), []);
  for (const mutate of [
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.id = 'gid://shopify/Product/999';
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.variantsTruncated = true;
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.variants.pop();
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.variants.push({ ...catalog.variants[0]!, id: 'gid://shopify/ProductVariant/203' });
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.variants[1]!.selectedOptions[0]!.value = 'Red';
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.options![0]!.id = 'gid://shopify/ProductOption/999';
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.options![0]!.name = 'Fabricated';
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.options![0]!.values[1] = 'Green';
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.images = [catalog.images![0]!];
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.images![1]!.url = 'https://cdn.shopify.com/replaced.jpg';
    },
    (catalog: ReturnType<typeof currentCatalogue>) => {
      catalog.images![1]!.width = 900;
    },
  ]) {
    const catalog = structuredClone(currentCatalogue());
    mutate(catalog);
    assert.ok(selectedPublicationProblems(selectedProductDraft(value, previous), catalog).length > 0);
  }
});

test('assignment image identity is preserved even when catalog images share a URL', () => {
  const value = groupedSetup();
  value.product.images[1]!.url = value.product.images[0]!.url;
  const draft = selectedProductDraft(value, previous);
  assert.deepEqual((draft.geometry as { views: { variantImages: unknown[] }[] }).views[0]!.variantImages, [
    { variantId: 'variant_202', image: { revisionId: 'image_222', width: 800, height: 1000 } },
  ]);
  const catalog = currentCatalogue();
  assert.match(selectedPublicationProblems(draft, catalog).join(' '), /media changed/i);
});

test('inactive cached group assignments are retained but never affect active geometry or publication coverage', () => {
  const value = groupedSetup();
  const photos = value.product.variantPhotos!;
  photos.options.push({ id: 'size', name: 'Size', values: [{ id: 'Small', label: 'Small' }] });
  photos.variants.forEach((variant) => {
    variant.optionValues.size = 'Small';
  });
  photos.assignments.push({
    groupKey: '[["size","Small"]]',
    viewId: 'front',
    imageId: 'image_222',
    needsAlignmentReview: true,
    placementRects: { chest: { centerX: 0.7, centerY: 0.7, width: 0.1, height: 0.1 } },
  });
  let draft = selectedProductDraft(value, previous);
  assert.deepEqual(selectedPublicationProblems(draft), []);
  assert.deepEqual((draft.geometry as { views: { variantImages: unknown[] }[] }).views[0]!.variantImages, [
    { variantId: 'variant_202', image: { revisionId: 'image_222', width: 800, height: 1000 } },
  ]);
  photos.groupingOptionIds = [];
  draft = selectedProductDraft(value, previous);
  assert.deepEqual(
    (draft.geometry as { views: { variantImages: unknown[]; placements: { variantOverrides?: unknown[] }[] }[] })
      .views[0]!.variantImages,
    [],
  );
  assert.equal(
    (draft.geometry as { views: { placements: { variantOverrides?: unknown[] }[] }[] }).views[0]!.placements[0]!
      .variantOverrides,
    undefined,
  );
  assert.deepEqual(selectedPublicationProblems(draft), []);
  assert.equal(draft.selectedSetup!.product.variantPhotos!.assignments.length, 3);
});
test('foreign image, unknown alignment placement and fabricated variant IDs cannot project', () => {
  const image = groupedSetup();
  image.product.variantPhotos!.assignments[1]!.imageId = 'foreign_image';
  assert.throws(() => selectedProductDraft(image, previous), /image/i);
  const area = groupedSetup();
  area.product.variantPhotos!.assignments[1]!.placementRects!.foreign_placement = {
    centerX: 0.5,
    centerY: 0.5,
    width: 0.2,
    height: 0.2,
  };
  assert.throws(() => selectedProductDraft(area, previous), /placement/i);
  const variant = groupedSetup();
  variant.product.variantPhotos!.variants[1]!.id = 'fabricated_variant';
  assert.throws(() => selectedProductDraft(variant, previous), /Shopify variant identity/);
});
test('qualified per-view image and per-placement alignment limits fail explicitly without truncation; shared defaults need no redundant overrides', () => {
  const value = groupedSetup();
  value.product.variantPhotos!.variants.push(
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `gid://shopify/ProductVariant/${300 + index}`,
      optionValues: { 'gid://shopify/ProductOption/10': 'Blue' },
    })),
  );
  assert.throws(() => selectedProductDraft(value, previous), /qualified appearance capacity/);
  value.product.variantPhotos!.assignments[1]!.imageId = undefined;
  value.product.variantPhotos!.assignments[1]!.useShared = true;
  assert.throws(() => selectedProductDraft(value, previous), /qualified appearance capacity/);
  delete value.product.variantPhotos!.assignments[1]!.placementRects;
  const draft = selectedProductDraft(value, previous);
  assert.deepEqual((draft.geometry as { views: { variantImages: unknown[]; placements: unknown[] }[] }).views[0], {
    id: 'front',
    image: { revisionId: 'product_111', width: 1000, height: 1200 },
    variantImages: [],
    placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
  });
});

test('calibration cannot use fabricated source pixel dimensions and geometry limits report their actual qualified bounds', () => {
  const value = groupedSetup();
  value.product.views[0]!.imageWidth = 900;
  value.product.views[0]!.calibration!.imageWidth = 900;
  assert.match(
    selectedPublicationProblems(selectedProductDraft(value, previous), currentCatalogue()).join(' '),
    /image dimensions/i,
  );
  const views = structuredClone(setup);
  views.product.views = Array.from({ length: 17 }, (_, index) => ({
    ...structuredClone(setup.product.views[0]!),
    id: `view_${index}`,
    placements: [],
  }));
  assert.throws(() => selectedProductDraft(views, previous), /16 views/);
});

test('variant artwork movement scales with its aligned placement while retaining permitted production area', () => {
  const value = groupedSetup();
  value.product.views[0]!.placements[0]!.customPlacementAllowed = true;
  value.product.views[0]!.placements[0]!.movementRect = { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 };
  const resolved = resolveVariantPhotoView(
    value.product,
    'front',
    value.product.variantPhotos!.assignments[1]!.groupKey,
  );
  assert.equal(resolved.needsAlignmentReview, false);
  assert.equal(resolved.view.calibration, undefined);
  const area = resolved.view.placements[0]!.movementRect!;
  assert.equal(area.centerX, 0.4);
  assert.equal(area.centerY, 0.6);
  assert.ok(Math.abs(area.width - 0.6) < 1e-12);
  assert.ok(Math.abs(area.height - 0.5) < 1e-12);
  assert.deepEqual(value.product.views[0]!.placements[0]!.movementRect, {
    centerX: 0.5,
    centerY: 0.5,
    width: 0.4,
    height: 0.4,
  });
});

test('full-length selected method and step identities project bounded stable pricing rule identities', () => {
  const changed = structuredClone(setup);
  const placement = changed.product.views[0]!.placements[0]!;
  placement.id = 'p'.repeat(128);
  placement.sizes = [{ id: 's'.repeat(128), name: 'Small', widthPercent: '100', prices: {} }];
  changed.product.methods = [
    { id: 'm'.repeat(128), name: 'Print', pricing: 'fixed', amount: '3.50' },
    { id: 'm'.repeat(127) + 'n', name: 'Second', pricing: 'fixed', amount: '4.00' },
  ];
  placement.methodIds = changed.product.methods.map((method) => method.id);
  const draft = selectedProductDraft(changed, previous);
  assert.equal(draft.pricingRules.length, 2);
  assert(draft.pricingRules.every((rule) => rule.id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(rule.id)));
  assert.equal(new Set(draft.pricingRules.map((rule) => rule.id)).size, 2);
  const original = new Map(
    draft.pricingRules.map((rule) => [rule.scope.kind === 'step' ? rule.scope.methodId : undefined, rule.id]),
  );
  placement.methodIds.reverse();
  const reordered = selectedProductDraft(changed, previous);
  for (const rule of reordered.pricingRules)
    assert.equal(rule.id, original.get(rule.scope.kind === 'step' ? rule.scope.methodId : undefined));
});

test('canonical tuple migration preserves only the legacy price label for the exact placement, step and method', () => {
  const changed = structuredClone(setup);
  const view = changed.product.views[0],
    area = view?.placements[0];
  assert(view && area);
  changed.product.methods = [
    { id: 'print', name: 'Print', pricing: 'fixed', amount: '1.00' },
    { id: 'd:print', name: 'Other', pricing: 'fixed', amount: '2.00' },
  ];
  view.placements = [
    {
      ...area,
      id: 'a:b',
      methodIds: ['print'],
      sizes: [{ id: 'c:d', name: 'Small', widthPercent: '100', prices: {} }],
    },
    {
      ...area,
      id: 'a',
      methodIds: ['d:print'],
      sizes: [{ id: 'b:c', name: 'Small', widthPercent: '100', prices: {} }],
    },
  ];
  const current = selectedProductDraft(changed, previous);
  assert.equal(new Set(current.pricingRules.map((rule) => rule.id)).size, 2);
  const geometry = current.geometry as { steps: { id: string }[] };
  const legacy = MerchantDraftSchema.parse({
    ...current,
    placements: current.placements.map((placement, index) => ({
      ...placement,
      allowedStepIds: [index ? 'a:b:c' : 'a:b:c:d'],
    })),
    geometry: {
      ...geometry,
      steps: geometry.steps.map((step, index) => ({ ...step, id: index ? 'a:b:c' : 'a:b:c:d' })),
    },
    pricingRules: current.pricingRules.map((rule, index) => ({
      ...rule,
      id: index ? 'legacy-other' : 'legacy-print',
      scope: { ...rule.scope, stepId: index ? 'a:b:c' : 'a:b:c:d' },
    })),
    labels: {
      ...current.labels,
      prices: { 'legacy-print': 'Print label', 'legacy-other': 'Other label', 'removed-price': 'Obsolete' },
    },
  });
  const migrated = selectedProductDraft(changed, legacy);
  assert.equal(migrated.labels?.prices?.[migrated.pricingRules[0]!.id], 'Print label');
  assert.equal(migrated.labels?.prices?.[migrated.pricingRules[1]!.id], 'Other label');
  assert.equal(Object.keys(migrated.labels?.prices ?? {}).length, 2);
});
test('copied retained production choices project into independently saved core definitions and labels', () => {
  const copied = structuredClone(setup);
  copied.product.productionChoices = {
    definitions: [{ id: 'new_thread', allowedValueIds: ['new_blue'] }],
    labels: { options: { new_thread: 'Thread colour' }, values: { new_thread: { new_blue: 'Blue' } } },
  };
  const draft = selectedProductDraft(copied, {
    ...previous,
    productionOptions: [{ id: 'old', allowedValueIds: ['old_value'] }],
    labels: { options: { old: 'Old' }, values: { old: { old_value: 'Old value' } } },
  });
  assert.deepEqual(draft.productionOptions, [{ id: 'new_thread', allowedValueIds: ['new_blue'] }]);
  assert.deepEqual(draft.labels?.options, { new_thread: 'Thread colour' });
  assert.deepEqual(draft.labels?.values, { new_thread: { new_blue: 'Blue' } });
  assert.deepEqual(copied.product.productionChoices.labels.options, { new_thread: 'Thread colour' });
});
test('retained asymmetric sizes preserve actual calibrated width and height independently', () => {
  const selected = SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: {
      id: 'gid://shopify/Product/111',
      title: 'Shirt',
      images: [{ id: 'image_1', url: 'https://cdn.shopify.com/front.jpg', width: 1000, height: 1000, alt: 'Front' }],
      methods: [{ id: 'print', name: 'Print', pricing: 'fixed', amount: '1.00' }],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: 'https://cdn.shopify.com/front.jpg',
          imageWidth: 1000,
          imageHeight: 1000,
          calibration: {
            imageUrl: 'https://cdn.shopify.com/front.jpg',
            imageWidth: 1000,
            imageHeight: 1000,
            a: { x: 0, y: 0 },
            b: { x: 0.5, y: 0 },
            distanceCm: 50,
          },
          placements: [
            {
              id: 'chest',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
              widthCm: '20',
              heightCm: '20',
              methodIds: ['print'],
              logoLaterAllowed: true,
              sizes: [{ id: 'small', name: 'Small', widthPercent: '50', heightPercent: '25', prices: {} }],
            },
          ],
        },
      ],
    },
  });
  const draft = selectedProductDraft(selected, previous);
  const geometry = validateGeometry(draft.geometry as GeometryV1);
  assert.equal(geometry.steps[0]?.widthFraction, 0.5);
  assert.equal(geometry.steps[0]?.heightFraction, 0.25);
  assert.deepEqual(geometry.steps[0]?.physicalMm, { width: 100, height: 50 });
});
