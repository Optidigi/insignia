import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BuyerConfigSchema, CustomerSelectedSetupSchema, SelectedProductSetupSchema } from '@insignia/contracts';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import { handleBuyerRequest } from '../src/server/buyer/http.ts';
import { createBuyerServices } from '../src/server/buyer/service.ts';
import { publicSelectedSetup } from '../src/server/merchant-preview/selected-public.ts';
import { fixtureCore } from './admin/support/durable-core.mts';
import { fixtureTransaction } from './admin/support/fixtures.mts';
import { buyerFixture, effectiveRevision } from './http-fixtures.mts';

function fixture() {
  const photo = (id: string) => ({
    id,
    url: `https://private-admin.example/api/admin/media/${id}?delivery-secret=${id}`,
    width: 1000,
    height: 1000,
    alt: id,
  });
  const placement = (id: string, methodIds: string[]) => ({
    id,
    name: id,
    rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
    widthCm: '20',
    heightCm: '20',
    methodIds,
    logoLaterAllowed: true,
    sizes: [
      { id: 'small', name: 'Small', widthPercent: '50', prices: { print: '3.50', 'merchant-only-method': '99.99' } },
    ],
  });
  const selected = SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: {
      print: {
        catalogMethodId: '11111111-1111-4111-8111-111111111111',
        observedVersion: '4',
        name: { source: 'catalog', value: 'Customer print' },
        explanation: { source: 'product', value: 'private-provenance-note' },
        translations: {},
        prices: { default: { source: 'catalog', value: '3.50' } },
        review: null,
      },
    },
    product: {
      id: 'gid://shopify/Product/111',
      title: 'Customer hoodie',
      images: [photo('shared'), photo('blue'), photo('inactive-private-photo'), photo('unused-private-photo')],
      methods: [
        {
          id: 'print',
          name: 'Customer print',
          explanation: 'Customer description',
          translations: { nl: { name: 'Drukwerk', explanation: 'Klantbeschrijving' } },
          pricing: 'product',
          amount: '',
        },
        {
          id: 'merchant-only-method',
          name: 'Merchant-only imported method',
          explanation: 'Private unused method notes',
          pricing: 'fixed',
          amount: '99.99',
        },
      ],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: photo('shared').url,
          imageWidth: 1000,
          imageHeight: 1000,
          calibration: {
            imageUrl: photo('shared').url,
            imageWidth: 1000,
            imageHeight: 1000,
            a: { x: 0, y: 0.5 },
            b: { x: 0.5, y: 0.5 },
            distanceCm: 50,
          },
          placements: [placement('chest', ['print']), placement('merchant-only-placement', ['merchant-only-method'])],
        },
        {
          id: 'merchant-only-view',
          name: 'Private authoring view',
          imageUrl: photo('unused-private-photo').url,
          imageWidth: 1000,
          imageHeight: 1000,
          placements: [],
        },
      ],
      variantPhotos: {
        options: [
          {
            id: 'color',
            name: 'Color',
            values: [
              { id: 'red', label: 'Red' },
              { id: 'blue', label: 'Blue' },
            ],
          },
          { id: 'size', name: 'Size', values: [{ id: 'M', label: 'M' }] },
        ],
        variants: [
          { id: 'gid://shopify/ProductVariant/11', optionValues: { color: 'red', size: 'M' } },
          { id: 'gid://shopify/ProductVariant/12', optionValues: { color: 'blue', size: 'M' } },
        ],
        groupingOptionIds: ['color'],
        assignments: [
          { groupKey: '[["color","red"]]', viewId: 'front', useShared: true },
          {
            groupKey: '[["color","blue"]]',
            viewId: 'front',
            imageId: 'blue',
            placementRects: {
              chest: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 },
              'merchant-only-placement': { centerX: 0.6, centerY: 0.6, width: 0.2, height: 0.2 },
            },
          },
          {
            groupKey: '[["size","M"]]',
            viewId: 'front',
            imageId: 'inactive-private-photo',
            needsAlignmentReview: true,
          },
          { groupKey: '[["color","red"]]', viewId: 'merchant-only-view', useShared: true },
        ],
      },
    },
  });
  const geometry: GeometryV1 = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'shared', width: 1000, height: 1000 },
        variantImages: [{ variantId: '12', image: { revisionId: 'blue', width: 1000, height: 1000 } }],
        placements: [
          {
            id: 'chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            variantOverrides: [{ variantId: '12', rect: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } }],
          },
        ],
      },
    ],
    steps: [{ id: 'chest:small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 100, height: 100 } }],
  };
  const urls: Record<string, string> = {
    shared: 'https://captured.example.test/shared.png',
    blue: 'https://captured.example.test/blue.png',
  };
  return { selected, geometry, urls };
}

test('buyer presentation exposes only configured methods, geometry photos and active assignments without changing private frozen authoring', () => {
  const f = fixture();
  const before = structuredClone(f.selected),
    geometryBefore = structuredClone(f.geometry);
  const result = publicSelectedSetup(f.selected, f.geometry, f.urls);
  assert.deepEqual(result.product.methods, [f.selected.product.methods[0]]);
  assert.deepEqual(result.methodBindings, {});
  assert.deepEqual(
    result.product.views.map((view) => view.id),
    ['front'],
  );
  assert.deepEqual(
    result.product.views[0]?.placements.map((placement) => placement.id),
    ['chest'],
  );
  assert.deepEqual(result.product.views[0]?.placements[0]?.sizes[0]?.prices, { print: '3.50' });
  assert.deepEqual(
    result.product.images.map((image) => [image.id, image.url]),
    [
      ['shared', f.urls.shared],
      ['blue', f.urls.blue],
    ],
  );
  assert.equal(result.product.views[0]?.imageUrl, f.urls.shared);
  assert.equal(result.product.views[0]?.calibration?.imageUrl, f.urls.shared);
  assert.deepEqual(result.product.variantPhotos?.assignments, [
    { groupKey: '[["color","red"]]', viewId: 'front', useShared: true },
    {
      groupKey: '[["color","blue"]]',
      viewId: 'front',
      imageId: 'blue',
      placementRects: { chest: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } },
    },
  ]);
  assert.deepEqual(result.product.variantPhotos?.options, f.selected.product.variantPhotos?.options);
  assert.deepEqual(result.product.variantPhotos?.variants, f.selected.product.variantPhotos?.variants);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-admin|delivery-secret|private-provenance|merchant-only|unused-private|inactive-private|99\.99/,
  );
  assert.deepEqual(f.selected, before);
  assert.deepEqual(f.geometry, geometryBefore);
});

test('missing or unsafe delivery URLs are unavailable rather than borrowed from merchant source media', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      delete f.urls.blue;
    },
    (f: ReturnType<typeof fixture>) => {
      f.urls.blue = 'http://captured.example.test/blue.png';
    },
    (f: ReturnType<typeof fixture>) => {
      f.urls.blue = 'https://merchant-secret@captured.example.test/blue.png';
    },
  ]) {
    const f = fixture();
    change(f);
    const before = structuredClone(f);
    const result = publicSelectedSetup(f.selected, f.geometry, f.urls);
    assert.deepEqual(
      result.product.images.map((image) => image.id),
      ['shared'],
    );
    assert.equal(result.product.views[0]?.imageUrl, f.urls.shared);
    const variant = result.product.variantPhotos?.assignments.find(
      (assignment) => assignment.groupKey === '[["color","blue"]]',
    );
    assert(variant);
    assert.equal(Object.hasOwn(variant, 'imageId'), false);
    assert.equal(Object.hasOwn(variant, 'useShared'), false);
    assert.deepEqual(variant.placementRects, { chest: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } });
    assert.doesNotMatch(JSON.stringify(result), /private-admin|delivery-secret|merchant-secret/);
    assert.deepEqual(f, before);
  }
});

test('available captures use factual canonical pixel dimensions without relying on stale merchant descriptors', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      const source = f.selected.product.images.find((image) => image.id === 'blue');
      assert(source);
      source.width = 900;
    },
    (f: ReturnType<typeof fixture>) => {
      f.selected.product.images = f.selected.product.images.filter((image) => image.id !== 'blue');
    },
  ]) {
    const f = fixture();
    change(f);
    const before = structuredClone(f);
    const result = publicSelectedSetup(f.selected, f.geometry, f.urls),
      blue = result.product.images.find((image) => image.id === 'blue');
    assert(blue);
    assert.equal(blue.url, f.urls.blue);
    assert.equal(blue.width, 1000);
    assert.equal(blue.height, 1000);
    assert.deepEqual(f, before);
  }
});

test('an active private-image cache outside the immutable geometry is never exposed as a runtime assignment', () => {
  const f = fixture(),
    assignment = f.selected.product.variantPhotos?.assignments.find((assignment) => assignment.imageId === 'blue');
  assert(assignment);
  assignment.imageId = 'inactive-private-photo';
  const before = structuredClone(f),
    result = publicSelectedSetup(f.selected, f.geometry, f.urls);
  assert.doesNotMatch(JSON.stringify(result), /inactive-private-photo|private-admin|delivery-secret/);
  const active = result.product.variantPhotos?.assignments.find(
    (assignment) => assignment.groupKey === '[["color","blue"]]',
  );
  assert(active);
  assert.equal(Object.hasOwn(active, 'imageId'), false);
  assert.deepEqual(f, before);
});

test('disabled appearance grouping publishes no cached assignments or unreferenced photo descriptors', () => {
  const f = fixture();
  assert(f.selected.product.variantPhotos);
  f.selected.product.variantPhotos.groupingOptionIds = [];
  const view = f.geometry.views[0];
  assert(view);
  view.variantImages = [];
  const placement = view.placements[0];
  assert(placement);
  placement.variantOverrides = [];
  const before = structuredClone(f.selected);
  const result = publicSelectedSetup(f.selected, f.geometry, f.urls);
  assert.deepEqual(result.product.variantPhotos?.assignments, []);
  assert.deepEqual(
    result.product.images.map((image) => image.id),
    ['shared'],
  );
  assert.deepEqual(f.selected, before);
});

test('inactive price-mode caches remain merchant-only while configured pricing semantics stay exact', () => {
  const product = fixture();
  const productMethod = product.selected.product.methods.find((method) => method.id === 'print');
  assert(productMethod);
  productMethod.amount = '77.77';
  const productBefore = structuredClone(product.selected);
  const productView = publicSelectedSetup(product.selected, product.geometry, product.urls);
  assert.equal(productView.product.methods[0]?.pricing, 'product');
  assert.equal(productView.product.methods[0]?.amount, '');
  assert.deepEqual(productView.product.views[0]?.placements[0]?.sizes[0]?.prices, { print: '3.50' });
  assert.deepEqual(product.selected, productBefore);
  const fixed = fixture();
  const fixedMethod = fixed.selected.product.methods.find((method) => method.id === 'print');
  assert(fixedMethod);
  fixedMethod.pricing = 'fixed';
  fixedMethod.amount = '3.50';
  const view = fixed.selected.product.views.find((view) => view.id === 'front');
  assert(view);
  const placement = view.placements.find((placement) => placement.id === 'chest');
  assert(placement);
  const size = placement.sizes[0];
  assert(size);
  size.prices.print = '88.88';
  const fixedBefore = structuredClone(fixed.selected),
    fixedView = publicSelectedSetup(fixed.selected, fixed.geometry, fixed.urls);
  assert.equal(fixedView.product.methods[0]?.pricing, 'fixed');
  assert.equal(fixedView.product.methods[0]?.amount, '3.50');
  assert.deepEqual(fixedView.product.views[0]?.placements[0]?.sizes[0]?.prices, {});
  assert.deepEqual(fixed.selected, fixedBefore);
});

test('a post-publication capture outage exposes unavailable previews while keeping immutable instructions and configured prices', () => {
  const f = fixture(),
    before = structuredClone(f);
  const result = publicSelectedSetup(f.selected, f.geometry, {});
  assert.deepEqual(result.product.images, []);
  const view = result.product.views[0];
  assert(view);
  assert.equal(view.imageUrl, '');
  assert.equal(Object.hasOwn(view, 'calibration'), false);
  for (const assignment of result.product.variantPhotos?.assignments ?? []) {
    assert.equal(Object.hasOwn(assignment, 'imageId'), false);
    assert.equal(Object.hasOwn(assignment, 'useShared'), false);
  }
  assert.deepEqual(view.placements[0]?.sizes[0]?.prices, { print: '3.50' });
  assert.deepEqual(view.placements[0]?.rect, { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 });
  assert.deepEqual(
    result.product.variantPhotos?.assignments.find((assignment) => assignment.groupKey === '[["color","blue"]]')
      ?.placementRects,
    { chest: { centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } },
  );
  assert.doesNotMatch(JSON.stringify(result), /private-admin|delivery-secret|data:image/);
  assert.deepEqual(f, before);
});

test('variant-only captures and absent default imagery remain explicit without inventing a shared garment', () => {
  const f = fixture(),
    view = f.geometry.views[0];
  assert(view);
  delete view.image;
  const before = structuredClone(f),
    result = publicSelectedSetup(f.selected, f.geometry, { blue: f.urls.blue ?? '' });
  assert.equal(result.product.views[0]?.imageUrl, '');
  assert.equal(result.product.views[0]?.calibration, undefined);
  assert.deepEqual(
    result.product.images.map((image) => image.id),
    ['blue'],
  );
  const shared = result.product.variantPhotos?.assignments.find((assignment) => assignment.useShared);
  assert.equal(shared, undefined);
  assert.equal(
    result.product.variantPhotos?.assignments.find((assignment) => assignment.imageId === 'blue')?.imageId,
    'blue',
  );
  assert.deepEqual(f, before);
});

test('purpose-specific customer reads preserve tiny positive legacy footprints without relaxing authoring', () => {
  const f = fixture(),
    view = f.selected.product.views[0],
    geometry = f.geometry.views[0];
  assert(view && geometry);
  const placement = view.placements.find((placement) => placement.id === 'chest'),
    area = geometry.placements[0];
  assert(placement && area);
  delete view.calibration;
  placement.rect = { centerX: 0.5, centerY: 0.5, width: 0.006, height: 0.004 };
  placement.customPlacementAllowed = true;
  placement.movementRect = { centerX: 0.5, centerY: 0.5, width: 0.012, height: 0.01 };
  area.rect = { ...placement.rect };
  const assignment = f.selected.product.variantPhotos?.assignments.find((assignment) => assignment.imageId === 'blue');
  assert(assignment?.placementRects);
  assignment.placementRects.chest = { centerX: 0.4, centerY: 0.4, width: 0.005, height: 0.003 };
  const override = area.variantOverrides?.[0];
  assert(override);
  override.rect = { ...assignment.placementRects.chest };
  assert.equal(
    SelectedProductSetupSchema.safeParse(f.selected).success,
    false,
    'New authoring keeps its existing minimum',
  );
  const before = structuredClone(f),
    result = publicSelectedSetup(f.selected, f.geometry, f.urls);
  assert.equal(CustomerSelectedSetupSchema.safeParse(result).success, true);
  assert.equal(
    SelectedProductSetupSchema.safeParse(result).success,
    false,
    'The read projection does not become authoring permission',
  );
  assert.deepEqual(result.product.views[0]?.placements[0]?.rect, {
    centerX: 0.5,
    centerY: 0.5,
    width: 0.006,
    height: 0.004,
  });
  assert.deepEqual(result.product.views[0]?.placements[0]?.movementRect, {
    centerX: 0.5,
    centerY: 0.5,
    width: 0.012,
    height: 0.01,
  });
  assert.deepEqual(
    result.product.variantPhotos?.assignments.find((assignment) => assignment.imageId === 'blue')?.placementRects
      ?.chest,
    { centerX: 0.4, centerY: 0.4, width: 0.005, height: 0.003 },
  );
  assert.deepEqual(f, before);
});

test('conflicting old image dimension metadata disables only that preview without altering immutable geometry', () => {
  const f = fixture(),
    front = f.geometry.views[0],
    source = f.selected.product.views[0];
  assert(front?.image && source);
  f.geometry.views.push({ id: 'back', image: { ...front.image, width: 900 }, variantImages: [], placements: [] });
  const back = structuredClone(source);
  back.id = 'back';
  back.name = 'Back';
  back.placements = [];
  back.imageWidth = 900;
  f.selected.product.views.push(back);
  const before = structuredClone(f),
    result = publicSelectedSetup(f.selected, f.geometry, f.urls);
  assert.deepEqual(
    result.product.images.map((image) => image.id),
    ['blue'],
  );
  assert.equal(result.product.views[0]?.imageUrl, '');
  assert.equal(result.product.views[1]?.imageUrl, '');
  assert.equal(result.product.views[0]?.imageWidth, 1000);
  assert.equal(result.product.views[1]?.imageWidth, 900);
  assert.equal(result.product.views[0]?.calibration, undefined);
  assert.equal(result.product.views[1]?.calibration, undefined);
  assert.deepEqual(f, before);
});

test('the actual buyer HTTP read retains frozen prices and production dimensions during a scoped preview outage', async () => {
  const f = fixture(),
    before = structuredClone(f),
    scope = { shopId: 'tenant', installationGeneration: '1', productId: '111' };
  const config = {
    ...effectiveRevision().config,
    productId: '111',
    methods: [{ id: 'print' }],
    placements: [{ id: 'chest', allowedMethodIds: ['print'], allowedStepIds: ['chest:small'], logoLaterAllowed: true }],
    pricingRules: [
      {
        id: 'price',
        scope: { kind: 'step' as const, placementId: 'chest', stepId: 'chest:small', methodId: 'print' },
        role: 'unit' as const,
        rate: { kind: 'fixed' as const, amount: { shopDecimal: '3.50', presentmentOverrides: [] } },
      },
    ],
  };
  const core = fixtureCore({
    acceptedQuotes: { getEffective: async () => ({ ...effectiveRevision(), config }) },
    configs: {
      getRevisionGeometry: async () => ({
        version: 'm5-geometry-v1',
        mode: 'required',
        contentHash: 'a'.repeat(64),
        value: f.geometry,
      }),
      getRevisionPresentation: async () => ({ version: 'm5-presentation-v1', labels: {}, selectedSetup: f.selected }),
    },
    preferences: {
      readWording: async () => ({ wordingVersion: '0', overlays: { en: { locale: 'en', messages: {} } } }),
    },
    transactions: { run: async (work) => work(fixtureTransaction) },
  });
  const service = createBuyerServices({
    core,
    guest: buyerFixture({ guest: { resolve: async () => scope } }).guest,
    ports: () => {
      throw Error('A public read cannot authorize money');
    },
    catalog: async () => ({
      title: 'Customer hoodie',
      currency: 'USD',
      variants: [
        {
          id: '11',
          label: 'Red M',
          available: true,
          selectedOptions: [
            { name: 'Color', value: 'red' },
            { name: 'Size', value: 'M' },
          ],
          baseUnitMinor: '2000',
        },
        {
          id: '12',
          label: 'Blue M',
          available: true,
          selectedOptions: [
            { name: 'Color', value: 'blue' },
            { name: 'Size', value: 'M' },
          ],
          baseUnitMinor: '2000',
        },
      ],
      imageUrls: {},
    }),
    configurationReady: async () => {},
    previewImages: async () => ({}),
  });
  const response = await handleBuyerRequest(
    new Request('https://app.example/v1/config?productId=111&country=US'),
    service,
    'config',
  );
  assert.equal(response.status, 200);
  const result = BuyerConfigSchema.parse(await response.json());
  assert.equal(result.ready, true);
  assert.equal(result.contentHash, config.revisionContentHash);
  assert.deepEqual(result.geometry, f.geometry);
  assert.deepEqual(result.imageUrls, {});
  assert.deepEqual(result.decorationPrices, [
    { placementId: 'chest', methodId: 'print', stepId: 'chest:small', minor: '350' },
  ]);
  assert.equal(result.selectedSetup?.product.views[0]?.imageUrl, '');
  assert.deepEqual(result.selectedSetup?.product.images, []);
  assert.equal(result.selectedSetup?.product.views[0]?.calibration, undefined);
  assert.deepEqual(f, before);
});
