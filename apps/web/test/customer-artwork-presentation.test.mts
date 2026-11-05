import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getVariantPhotoGroups, SelectedProductSetupSchema } from '@insignia/contracts';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import { scopeCustomerArtworkPresentation } from '../src/server/customer-artwork/presentation.ts';
import { publicSelectedSetup } from '../src/server/merchant-preview/selected-public.ts';

const photo = (id: string) => ({
  id,
  url: `https://private-source.test/${id}.png`,
  width: 1000,
  height: 1000,
  alt: id,
});
function fixture(ids = ['12']) {
  const setup = SelectedProductSetupSchema.parse({
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: {
      id: 'gid://shopify/Product/111',
      title: 'Shirt',
      images: [photo('shared'), photo('blue'), photo('red'), photo('unused')],
      methods: [
        { id: 'print', name: 'Print', pricing: 'fixed', amount: '3.50' },
        { id: 'stitch', name: 'Stitch', pricing: 'fixed', amount: '7.25' },
      ],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: photo('shared').url,
          imageWidth: 1000,
          imageHeight: 1000,
          placements: [
            {
              id: 'chest',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
              widthCm: '20',
              heightCm: '20',
              methodIds: ['print', 'stitch'],
              sizes: [
                { id: 'small', name: 'Small', widthPercent: '50', prices: { stitch: '7.25' } },
                { id: 'large', name: 'Large', widthPercent: '100', prices: { stitch: '10' } },
              ],
              logoLaterAllowed: true,
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
              { id: 'Green', label: 'Green' },
            ],
          },
        ],
        variants: [
          { id: 'gid://shopify/ProductVariant/12', label: 'Blue', optionValues: { color: 'Blue' } },
          { id: 'gid://shopify/ProductVariant/13', label: 'Red', optionValues: { color: 'Red' } },
          { id: 'gid://shopify/ProductVariant/14', label: 'Green', optionValues: { color: 'Green' } },
        ],
        groupingOptionIds: ['color'],
        assignments: [],
      },
    },
  });
  setup.product.variantPhotos!.assignments = getVariantPhotoGroups(setup.product).map((group) => ({
    groupKey: group.key,
    viewId: 'front',
    imageId: group.label === 'Blue' ? 'blue' : group.label === 'Red' ? 'red' : 'unused',
  }));
  const geometry: GeometryV1 = {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'shared', width: 1000, height: 1000 },
        variantImages: [
          { variantId: '12', image: { revisionId: 'blue', width: 1000, height: 1000 } },
          { variantId: '13', image: { revisionId: 'red', width: 1000, height: 1000 } },
          { variantId: '14', image: { revisionId: 'unused', width: 1000, height: 1000 } },
        ],
        placements: [
          {
            id: 'chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            variantOverrides: [
              { variantId: '12', rect: { centerX: 0.3, centerY: 0.4, width: 0.3, height: 0.3 } },
              { variantId: '13', rect: { centerX: 0.7, centerY: 0.4, width: 0.25, height: 0.25 } },
            ],
          },
        ],
      },
    ],
    steps: [
      { id: 'chest:small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } },
      { id: 'chest:large', widthFraction: 1, heightFraction: 1, physicalMm: { width: 100, height: 100 } },
    ],
  };
  const group = {
    version: 'm2-customization-group-v1' as const,
    shopId: 'shop',
    productId: '111',
    configRevisionId: 'revision',
    revisionContentHash: 'a'.repeat(64),
    design: {
      placements: [
        {
          placementId: 'chest',
          methodId: 'print',
          stepId: 'chest:small',
          artwork: { kind: 'deferred' as const, intentId: 'later' },
          position: { xMicros: 450000, yMicros: 500000 },
        },
      ],
      options: [],
    },
    variants: ids.map((variantId) => ({ variantId, quantity: 1 })),
  };
  const slots = [
    {
      groupIndex: 0,
      placementId: 'chest',
      productId: '111',
      revisionId: 'revision',
      methodId: 'print',
      stepId: 'chest:small',
    },
  ];
  return { setup, geometry, group, slots };
}
test('post-order preview uses purchased variant geometry and removes unrelated appearances, choices and real prices', () => {
  const f = fixture(),
    scoped = scopeCustomerArtworkPresentation(f.setup, f.geometry, f.group, f.slots);
  const publicView = publicSelectedSetup(scoped.selectedSetup, scoped.geometry, {
    blue: 'https://captured.test/blue.png',
  });
  assert.deepEqual(scoped.variantIds, ['12']);
  assert.equal(publicView.product.views[0]?.imageUrl, 'https://captured.test/blue.png');
  assert.deepEqual(scoped.geometry.views[0]?.placements[0]?.rect, {
    centerX: 0.3,
    centerY: 0.4,
    width: 0.3,
    height: 0.3,
  });
  const placement = publicView.product.views[0]?.placements[0];
  assert(placement);
  assert.equal(placement.sizes.length, 1);
  assert.equal(placement.sizes[0]?.widthPercent, '50');
  assert.deepEqual(placement.sizes[0]?.prices, {});
  assert.deepEqual(placement.methodIds, ['print']);
  assert.equal(placement.customPlacementAllowed, false);
  assert.equal(placement.logoLaterAllowed, false);
  assert.deepEqual(
    publicView.product.methods.map((method) => [method.id, method.amount]),
    [['print', '0']],
  );
  assert.deepEqual(
    publicView.product.images.map((image) => image.id),
    ['blue'],
  );
  assert.deepEqual(
    publicView.product.variantPhotos?.variants.map((variant) => variant.id),
    ['gid://shopify/ProductVariant/12'],
  );
  assert.deepEqual(scoped.positions, [{ placementId: 'chest', position: { xMicros: 450000, yMicros: 500000 } }]);
  assert.equal(f.setup.product.methods[0]?.amount, '3.50');
});
test('all actually purchased appearances remain representable and missing original option metadata never invents a preview', () => {
  const f = fixture(['12', '13']),
    scoped = scopeCustomerArtworkPresentation(f.setup, f.geometry, f.group, f.slots);
  assert.deepEqual(
    scoped.geometry.views[0]?.variantImages.map((value) => value.variantId),
    ['13'],
  );
  assert.equal(scoped.selectedSetup.product.variantPhotos?.assignments.length, 2);
  assert.deepEqual(
    scoped.selectedSetup.product.variantPhotos?.options[0]?.values.map((value) => value.label),
    ['Blue', 'Red'],
  );
  delete f.setup.product.variantPhotos;
  assert.throws(() => scopeCustomerArtworkPresentation(f.setup, f.geometry, f.group, f.slots), /PREVIEW_UNAVAILABLE/);
  const one = fixture();
  delete one.setup.product.variantPhotos;
  const single = scopeCustomerArtworkPresentation(one.setup, one.geometry, one.group, one.slots);
  assert.equal(single.geometry.views[0]?.image?.revisionId, 'blue');
});

test('old frozen post-order facts without selected authoring produce scoped upload-only instructions, including rectangular tiny geometry', async () => {
  const { canonicalCustomerArtworkPresentation } = await import(
    '../src/server/customer-artwork/canonical-presentation.ts'
  );
  const { CustomerArtworkPublicViewSchema } = await import('@insignia/contracts');
  const f = fixture(['12', '13']);
  f.geometry.steps[0]!.heightFraction = 0.25;
  f.geometry.views[0]!.placements[0]!.variantOverrides![0]!.rect.width = 0.01;
  const old = JSON.stringify(f.group),
    value = canonicalCustomerArtworkPresentation({
      productId: '111',
      presentation: {
        version: 'm5-presentation-v1',
        labels: { methods: { print: 'Print' }, placements: { chest: 'Chest' }, steps: { 'chest:small': 'Small' } },
      },
      geometry: f.geometry,
      group: f.group,
      slots: f.slots,
      imageUrls: { blue: 'https://captured.test/blue.png', red: 'https://captured.test/red.png' },
    });
  assert.deepEqual(value.variantIds, ['12', '13']);
  assert.equal(value.readProduct.views[0]?.imageUrl, 'https://captured.test/blue.png');
  assert.equal(value.readProduct.views[0]?.placements[0]?.rect.width, 0.01);
  assert.equal(value.readProduct.views[0]?.placements[0]?.sizes[0]?.heightPercent, '25');
  assert.deepEqual(
    value.readProduct.methods.map((method) => method.amount),
    ['0'],
  );
  assert.deepEqual(value.readProduct.views[0]?.placements[0]?.sizes[0]?.prices, {});
  assert.equal(JSON.stringify(f.group), old);
  const configuration = {
    groupIndex: 0,
    productId: '111',
    revisionId: 'revision',
    contentHash: 'a'.repeat(64),
    slots: f.slots,
    ...value,
  };
  assert.equal(
    CustomerArtworkPublicViewSchema.parse({
      purchaseId: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2027-01-01T00:00:00Z',
      artworkVersion: 0,
      slots: f.slots,
      configurations: [configuration],
    }).configurations[0]?.readProduct?.views.length,
    1,
  );
  const unavailable = canonicalCustomerArtworkPresentation({
    productId: '111',
    presentation: { version: 'm5-presentation-v1', labels: {} },
    geometry: f.geometry,
    group: f.group,
    slots: f.slots,
    imageUrls: {},
  });
  assert.equal(unavailable.readProduct.views[0]?.imageUrl, '');
  assert.deepEqual(unavailable.readProduct.images, []);
  assert.equal(unavailable.geometry.steps[0]?.physicalMm?.width, 50);
  delete f.geometry.steps[0]!.physicalMm;
  assert.throws(
    () =>
      canonicalCustomerArtworkPresentation({
        productId: '111',
        presentation: { version: 'm5-presentation-v1', labels: {} },
        geometry: f.geometry,
        group: f.group,
        slots: f.slots,
        imageUrls: {},
      }),
    /PREVIEW_UNAVAILABLE/,
  );
});
