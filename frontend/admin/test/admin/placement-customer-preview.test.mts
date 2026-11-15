import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerPreviewReadiness } from '../../examples/admin/support/placement-customer-preview.mts';

const methodId = 'cc756ade-f50a-4f5c-94b7-fd320a7a75e6';
const imageUrl = 'https://cdn.shopify.com/synthetic/shirt-front.jpg';
const wit = '[["colour","Wit"]]';

function view(id: string, name: string, image: string) {
  return {
    id,
    name,
    imageUrl: image,
    imageWidth: 1000,
    imageHeight: 1000,
    placements: [
      {
        id: `${id}-print`,
        name: `${name} print`,
        rect: { centerX: 0.5, centerY: 0.4, width: 0.2, height: 0.15 },
        widthCm: '18',
        heightCm: '15',
        methodIds: [methodId],
        logoLaterAllowed: true,
        customPlacementAllowed: false,
        sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: {} }],
      },
    ],
  };
}

/** A copied setup: the Wit appearance has its front photo, the back view (with a placement) has none yet. */
function partiallyAssigned() {
  return {
    id: 'gid://shopify/Product/111',
    title: 'Shirt',
    images: [{ id: 'image_1', url: imageUrl, width: 1000, height: 1000, alt: 'Front' }],
    methods: [{ id: methodId, name: 'Printing', explanation: '', pricing: 'fixed', amount: '3.50' }],
    views: [view('front', 'Front', ''), view('back', 'Back', '')],
    variantPhotos: {
      options: [{ id: 'colour', name: 'Colour', values: [{ id: 'Wit', label: 'Wit' }] }],
      variants: [{ id: 'gid://shopify/ProductVariant/1', optionValues: { colour: 'Wit' } }],
      groupingOptionIds: ['colour'],
      assignments: [{ groupKey: wit, viewId: 'front', imageId: 'image_1' }],
    },
  };
}

test('a selected appearance missing a placement view image asks for that view image, not another appearance (#505)', () => {
  assert.deepEqual(customerPreviewReadiness(partiallyAssigned() as never, { appearanceGroupKey: wit }), {
    ready: false,
    reason: 'images-for-placement-views-required',
  });
});

test('without a selected appearance, assigned variant photos still ask for an appearance', () => {
  assert.deepEqual(customerPreviewReadiness(partiallyAssigned() as never), {
    ready: false,
    reason: 'assigned-images-required',
  });
});

test('once every placement view of the selected appearance has an image, the preview is ready', () => {
  const product = partiallyAssigned();
  product.variantPhotos.assignments.push({ groupKey: wit, viewId: 'back', imageId: 'image_1' });
  assert.deepEqual(customerPreviewReadiness(product as never, { appearanceGroupKey: wit }), { ready: true });
});
