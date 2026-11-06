import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placementProductSchema, resolveVariantPhotoView } from '@insignia/contracts';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import { LegacyVariantPhotoError, legacyVariantPhotos } from '../../src/islands/legacy-variant-photos.ts';
import type { CatalogProduct } from '../../src/shared/admin-view.ts';

const color = 'gid://shopify/ProductOption/10',
  size = 'gid://shopify/ProductOption/20';
const key = (colorValue: string, sizeValue: string) =>
  JSON.stringify([
    [color, colorValue],
    [size, sizeValue],
  ]);
function fixture() {
  const images = [
    { id: 'image_101', url: 'https://cdn.shopify.com/shared.jpg', width: 1000, height: 1200, alt: 'Shared' },
    { id: 'image_102', url: 'https://cdn.shopify.com/variant.jpg', width: 900, height: 1300, alt: 'Variant' },
  ];
  const catalog: CatalogProduct = {
    id: 'gid://shopify/Product/111',
    title: 'Actual shirt',
    status: 'ACTIVE',
    imageUrl: images[0]?.url ?? null,
    images,
    imagesTruncated: false,
    variantsTruncated: false,
    options: [
      { id: color, name: 'Fabric', values: ['Blue', 'Red'] },
      { id: size, name: 'Fit', values: ['M', 'L'] },
    ],
    variants: [
      {
        id: 'gid://shopify/ProductVariant/11',
        title: 'Blue M',
        imageUrl: images[0]?.url ?? null,
        selectedOptions: [
          { name: 'Fabric', value: 'Blue' },
          { name: 'Fit', value: 'M' },
        ],
      },
      {
        id: 'gid://shopify/ProductVariant/12',
        title: 'Blue L',
        imageUrl: images[1]?.url ?? null,
        selectedOptions: [
          { name: 'Fit', value: 'L' },
          { name: 'Fabric', value: 'Blue' },
        ],
      },
      {
        id: 'gid://shopify/ProductVariant/13',
        title: 'Red M',
        imageUrl: images[0]?.url ?? null,
        selectedOptions: [
          { name: 'Fabric', value: 'Red' },
          { name: 'Fit', value: 'M' },
        ],
      },
    ],
  };
  const geometry: GeometryV1 = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'image_101', width: 1000, height: 1200 },
        variantImages: [{ variantId: 'variant_12', image: { revisionId: 'image_102', width: 900, height: 1300 } }],
        placements: [
          {
            id: 'chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            variantOverrides: [{ variantId: '12', rect: { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 } }],
          },
        ],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 60 } }],
  };
  const product = placementProductSchema.parse({
    id: catalog.id,
    title: catalog.title,
    images,
    methods: [{ id: 'print', name: 'Print', pricing: 'product', amount: '' }],
    views: [
      {
        id: 'front',
        name: 'Front',
        imageUrl: images[0]?.url ?? '',
        imageWidth: 1000,
        imageHeight: 1200,
        placements: [
          {
            id: 'chest',
            name: 'Chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            widthCm: '10',
            heightCm: '12',
            methodIds: ['print'],
            logoLaterAllowed: true,
            sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: { print: '3.50' } }],
          },
        ],
      },
    ],
  });
  return { geometry, catalog, views: product.views, images: product.images, product };
}

test('legacy appearances use every actual option ID, exact variant IDs, original image choices and nonuniform placement overrides', () => {
  const f = fixture(),
    before = structuredClone(f),
    result = legacyVariantPhotos(f);
  assert.deepEqual(result.groupingOptionIds, [color, size]);
  assert.deepEqual(result.options, [
    {
      id: color,
      name: 'Fabric',
      values: [
        { id: 'Blue', label: 'Blue' },
        { id: 'Red', label: 'Red' },
      ],
    },
    {
      id: size,
      name: 'Fit',
      values: [
        { id: 'M', label: 'M' },
        { id: 'L', label: 'L' },
      ],
    },
  ]);
  assert.deepEqual(
    result.variants.map((variant) => variant.id),
    f.catalog.variants.map((variant) => variant.id),
  );
  assert.deepEqual(result.assignments, [
    { groupKey: key('Blue', 'M'), viewId: 'front', useShared: true, needsAlignmentReview: false },
    {
      groupKey: key('Blue', 'L'),
      viewId: 'front',
      imageId: 'image_102',
      placementRects: { chest: { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 } },
      needsAlignmentReview: false,
    },
    { groupKey: key('Red', 'M'), viewId: 'front', useShared: true, needsAlignmentReview: false },
  ]);
  assert.equal(
    new Set(result.assignments.map((assignment) => assignment.groupKey)).size,
    3,
    'Equal Fabric values never collapse distinct actual variants',
  );
  assert.deepEqual(f, before);
});

test('the selected resolver observes the exact legacy effective photo and rectangle for each real variant', () => {
  const f = fixture();
  const product = { ...f.product, variantPhotos: legacyVariantPhotos(f) };
  const specific = resolveVariantPhotoView(product, 'front', key('Blue', 'L'));
  assert.equal(specific.view.imageUrl, 'https://cdn.shopify.com/variant.jpg');
  assert.equal(specific.view.imageWidth, 900);
  assert.equal(specific.view.imageHeight, 1300);
  assert.deepEqual(specific.view.placements[0]?.rect, { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 });
  const shared = resolveVariantPhotoView(product, 'front', key('Blue', 'M'));
  assert.equal(shared.view.imageUrl, 'https://cdn.shopify.com/shared.jpg');
  assert.deepEqual(shared.view.placements[0]?.rect, { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 });
});

test('explicit same-value variant image and rectangle overrides stay explicit rather than becoming inherited', () => {
  const f = fixture();
  const view = f.geometry.views[0];
  assert(view?.image);
  const area = view.placements[0];
  assert(area);
  view.variantImages.push({ variantId: '13', image: { ...view.image } });
  area.variantOverrides?.push({ variantId: 'variant_13', rect: { ...area.rect } });
  const before = structuredClone(f),
    result = legacyVariantPhotos(f);
  const assignment = result.assignments.find((assignment) => assignment.groupKey === key('Red', 'M'));
  assert(assignment);
  assert.equal(assignment.imageId, 'image_101');
  assert.equal(assignment.useShared, undefined);
  assert.deepEqual(assignment.placementRects, { chest: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } });
  const rect = assignment.placementRects?.chest;
  assert(rect);
  rect.centerX = 0.6;
  assert.deepEqual(f, before, 'Later edits to the returned authoring state cannot mutate the stored geometry');
});

test('missing variant media stays explicitly missing and retains its original alignment override', () => {
  const f = fixture();
  f.images = f.images.filter((image) => image.id !== 'image_102');
  f.catalog.images = f.catalog.images?.filter((image) => image.id !== 'image_102');
  const before = structuredClone(f),
    result = legacyVariantPhotos(f),
    assignment = result.assignments.find((assignment) => assignment.groupKey === key('Blue', 'L'));
  assert(assignment);
  assert.equal(assignment.imageId, undefined);
  assert.equal(assignment.useShared, undefined);
  assert.equal(assignment.needsAlignmentReview, true);
  assert.deepEqual(assignment.placementRects, { chest: { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 } });
  assert.deepEqual(f, before);
});

test('missing shared media never borrows a current variant image as the default', () => {
  const f = fixture();
  f.images = f.images.filter((image) => image.id !== 'image_101');
  f.catalog.images = f.catalog.images?.filter((image) => image.id !== 'image_101');
  const view = f.views[0];
  assert(view);
  view.imageUrl = '';
  const result = legacyVariantPhotos(f),
    shared = result.assignments.find((assignment) => assignment.groupKey === key('Blue', 'M')),
    specific = result.assignments.find((assignment) => assignment.groupKey === key('Blue', 'L'));
  assert(shared && specific);
  assert.equal(shared.imageId, undefined);
  assert.equal(shared.useShared, undefined);
  assert.equal(shared.needsAlignmentReview, true);
  assert.equal(specific.imageId, 'image_102');
  assert.equal(specific.needsAlignmentReview, false);
});

test('logical delivery aliases and dimension drift require review even when a current photo is available', () => {
  const alias = fixture();
  const geometry = alias.geometry.views[0];
  assert(geometry?.image);
  geometry.image.revisionId = 'product_111';
  for (const image of alias.images) if (image.id === 'image_101') image.id = 'product_111';
  for (const image of alias.catalog.images ?? []) if (image.id === 'image_101') image.id = 'product_111';
  assert.equal(
    legacyVariantPhotos(alias).assignments.find((assignment) => assignment.groupKey === key('Blue', 'M'))
      ?.needsAlignmentReview,
    true,
  );
  const changed = fixture();
  for (const image of changed.images) if (image.id === 'image_102') image.width = 950;
  for (const image of changed.catalog.images ?? []) if (image.id === 'image_102') image.width = 950;
  const assignment = legacyVariantPhotos(changed).assignments.find(
    (assignment) => assignment.groupKey === key('Blue', 'L'),
  );
  assert(assignment);
  assert.equal(assignment.imageId, 'image_102');
  assert.equal(assignment.needsAlignmentReview, true);
  assert.deepEqual(assignment.placementRects, { chest: { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 } });
});

test('incomplete, truncated, fabricated or ambiguous Shopify catalogue facts fail closed', () => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
    [
      'unknown variant completeness',
      (f) => {
        delete f.catalog.variantsTruncated;
      },
    ],
    [
      'unknown photo completeness',
      (f) => {
        delete f.catalog.imagesTruncated;
      },
    ],
    [
      'truncated variants',
      (f) => {
        f.catalog.variantsTruncated = true;
      },
    ],
    [
      'truncated photos',
      (f) => {
        f.catalog.imagesTruncated = true;
      },
    ],
    [
      'missing axes',
      (f) => {
        delete f.catalog.options;
      },
    ],
    [
      'missing variants',
      (f) => {
        f.catalog.variants = [];
      },
    ],
    [
      'guessed option ID',
      (f) => {
        const option = f.catalog.options?.[0];
        assert(option);
        option.id = 'guessed-color';
      },
    ],
    [
      'partial variant axes',
      (f) => {
        f.catalog.variants[0]?.selectedOptions.pop();
      },
    ],
    [
      'unknown option value',
      (f) => {
        const choice = f.catalog.variants[0]?.selectedOptions[0];
        assert(choice);
        choice.value = 'Gold';
      },
    ],
    [
      'not a real variant ID',
      (f) => {
        const variant = f.catalog.variants[0];
        assert(variant);
        variant.id = 'variant_11';
      },
    ],
    [
      'repeated actual variant ID',
      (f) => {
        const a = f.catalog.variants[0],
          b = f.catalog.variants[1];
        assert(a && b);
        b.id = a.id;
      },
    ],
    [
      'ambiguous actual combination',
      (f) => {
        const a = f.catalog.variants[0],
          b = f.catalog.variants[1];
        assert(a && b);
        b.selectedOptions = structuredClone(a.selectedOptions);
      },
    ],
    [
      'ambiguous axis names',
      (f) => {
        const a = f.catalog.options?.[0],
          b = f.catalog.options?.[1];
        assert(a && b);
        b.name = a.name;
      },
    ],
  ];
  for (const [name, change] of cases) {
    const f = fixture();
    change(f);
    const before = structuredClone(f);
    assert.throws(
      () => legacyVariantPhotos(f),
      (error: unknown) => error instanceof LegacyVariantPhotoError && error.code === 'catalog-incomplete',
      name,
    );
    assert.deepEqual(f, before);
  }
});

test('unknown or ambiguous stored variant selectors cannot silently lose their old overrides', () => {
  for (const selector of ['legacy-blue', 'variant_999', 'variant_012']) {
    const f = fixture();
    const value = f.geometry.views[0]?.variantImages[0];
    assert(value);
    value.variantId = selector;
    assert.throws(
      () => legacyVariantPhotos(f),
      (error: unknown) => error instanceof LegacyVariantPhotoError && error.code === 'variant-reference',
    );
  }
  for (const kind of ['image', 'rectangle'] as const) {
    const f = fixture(),
      view = f.geometry.views[0];
    assert(view);
    if (kind === 'image') {
      const original = view.variantImages[0];
      assert(original);
      view.variantImages.push({ ...original, variantId: '12' });
    } else {
      const area = view.placements[0],
        original = area?.variantOverrides?.[0];
      assert(area && original);
      area.variantOverrides?.push({ ...original, variantId: 'variant_12' });
    }
    assert.throws(
      () => legacyVariantPhotos(f),
      (error: unknown) => error instanceof LegacyVariantPhotoError && error.code === 'variant-reference',
    );
  }
});

test('each view receives its own exact image and placement instructions', () => {
  const f = fixture(),
    source = f.geometry.views[0],
    projected = f.views[0];
  assert(source?.image && projected);
  const geometry = structuredClone(source),
    view = structuredClone(projected);
  geometry.id = 'back';
  view.id = 'back';
  view.name = 'Back';
  const area = geometry.placements[0],
    placement = view.placements[0];
  assert(area && placement);
  area.id = 'back-logo';
  placement.id = 'back-logo';
  geometry.variantImages = [{ variantId: '11', image: { revisionId: 'image_102', width: 900, height: 1300 } }];
  area.variantOverrides = [];
  f.geometry.views.push(geometry);
  f.views.push(view);
  const result = legacyVariantPhotos(f);
  assert.equal(result.assignments.length, 6);
  assert.equal(
    result.assignments.find((assignment) => assignment.groupKey === key('Blue', 'M') && assignment.viewId === 'back')
      ?.imageId,
    'image_102',
  );
  assert.equal(
    result.assignments.find((assignment) => assignment.groupKey === key('Blue', 'L') && assignment.viewId === 'back')
      ?.useShared,
    true,
  );
  assert.deepEqual(
    result.assignments.find((assignment) => assignment.groupKey === key('Blue', 'L') && assignment.viewId === 'front')
      ?.placementRects,
    { chest: { centerX: 0.4, centerY: 0.45, width: 0.3, height: 0.15 } },
  );
});

test('the current selected assignment capacity is explicit and never truncates a complete catalogue', () => {
  const f = fixture();
  f.catalog.options = [
    { id: color, name: 'Actual axis', values: Array.from({ length: 130 }, (_, index) => `Value ${index}`) },
  ];
  f.catalog.variants = Array.from({ length: 130 }, (_, index) => ({
    id: `gid://shopify/ProductVariant/${2000 + index}`,
    title: `Actual variant ${index}`,
    imageUrl: f.catalog.imageUrl,
    selectedOptions: [{ name: 'Actual axis', value: `Value ${index}` }],
  }));
  const original = f.geometry.views[0],
    projected = f.views[0];
  assert(original && projected);
  f.geometry.views = Array.from({ length: 16 }, (_, index) => ({
    ...structuredClone(original),
    id: `view-${index}`,
    variantImages: [],
    placements: [],
  }));
  f.views = Array.from({ length: 16 }, (_, index) => ({
    ...structuredClone(projected),
    id: `view-${index}`,
    placements: [],
  }));
  const before = structuredClone(f);
  assert.throws(
    () => legacyVariantPhotos(f),
    (error: unknown) => error instanceof LegacyVariantPhotoError && error.code === 'capacity-exceeded',
  );
  assert.deepEqual(f, before);
});

test('a partial or reinterpreted projection is rejected before any legacy instructions can disappear', () => {
  const cases: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.views = [];
    },
    (f) => {
      const view = f.views[0];
      assert(view);
      view.placements = [];
    },
    (f) => {
      const placement = f.views[0]?.placements[0];
      assert(placement);
      placement.rect.centerX = 0.45;
    },
    (f) => {
      const view = f.views[0];
      assert(view);
      view.imageUrl = 'https://cdn.shopify.com/another-current-photo.jpg';
    },
  ];
  for (const change of cases) {
    const f = fixture();
    change(f);
    const before = structuredClone(f);
    assert.throws(
      () => legacyVariantPhotos(f),
      (error: unknown) => error instanceof LegacyVariantPhotoError && error.code === 'projection-mismatch',
    );
    assert.deepEqual(f, before);
  }
});
