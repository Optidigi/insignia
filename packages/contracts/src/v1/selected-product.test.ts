import { describe, expect, it } from 'vitest';
import { placementProductSchema } from './selected-product.js';

const photo = 'https://cdn.shopify.com/product-front.jpg';
const product = {
  id: '111',
  title: 'T-shirt',
  images: [{ id: 'front-photo', url: photo, width: 1000, height: 1200, alt: 'Front' }],
  methods: [{ id: 'print', name: 'Printing', pricing: 'fixed', amount: '5.00' }],
  views: [
    {
      id: 'front',
      name: 'Front',
      imageUrl: photo,
      imageWidth: 1000,
      imageHeight: 1200,
      calibration: {
        imageUrl: photo,
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
          methodIds: ['print'],
          logoLaterAllowed: true,
          customPlacementAllowed: true,
          movementRect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
          sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: {} }],
        },
      ],
    },
  ],
};

describe('selected product authoring boundary', () => {
  it('preserves the selected editor calibration, movement and explicit unavailable size prices through persistence', () => {
    expect(placementProductSchema.parse(JSON.parse(JSON.stringify(product)))).toEqual(product);
  });
  it('permits an incomplete draft without inventing published images, methods or prices', () => {
    const draft = { id: '111', title: 'T-shirt', images: [], views: [], methods: [] };
    expect(placementProductSchema.parse(draft)).toEqual(draft);
  });
  it('rejects unknown authority fields and movement outside the image instead of silently dropping them', () => {
    expect(placementProductSchema.safeParse({ ...product, shopId: 'another-shop' }).success).toBe(false);
    const invalid = structuredClone(product);
    invalid.views[0]!.placements[0]!.movementRect.centerX = 0.05;
    expect(placementProductSchema.safeParse(invalid).success).toBe(false);
  });
});

it('keeps short commerce identities stable and supports full-length original placement/size IDs', async () => {
  const { selectedStepIdentity } = await import('./selected-product.js');
  expect(selectedStepIdentity('chest', 'small')).toBe('chest:small');
  expect(selectedStepIdentity('p'.repeat(128), 's'.repeat(128))).toBe(
    'step_d0b8959a79480de0f5fa3b994b7db6ec80430e9cd03a787043f33617833959a9',
  );
  expect(() => selectedStepIdentity('bad/id', 'size')).toThrow();
});

it('accepts a retained customer artwork footprint below the merchant handle minimum without weakening authoring geometry', async () => {
  const { CustomerArtworkPublicViewSchema } = await import('./customer-artwork.js');
  const effective = structuredClone(product);
  effective.views[0]!.placements[0]!.rect.width = 0.005;
  effective.views[0]!.placements[0]!.rect.height = 0.005;
  const slot = {
    groupIndex: 0,
    placementId: 'chest',
    productId: '111',
    revisionId: 'revision',
    methodId: 'print',
    stepId: 'chest:small',
  };
  expect(
    CustomerArtworkPublicViewSchema.safeParse({
      purchaseId: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2027-01-01T00:00:00Z',
      artworkVersion: 0,
      slots: [slot],
      configurations: [
        {
          groupIndex: 0,
          productId: '111',
          revisionId: 'revision',
          slots: [slot],
          selectedSetup: { version: 'selected-product-setup-v1', methodBindings: {}, product: effective },
          contentHash: 'a'.repeat(64),
          geometry: {},
          variantIds: ['101'],
          positions: [],
        },
      ],
    }).success,
  ).toBe(true);
  expect(placementProductSchema.safeParse(effective).success).toBe(false);
  effective.views[0]!.placements[0]!.rect.centerX = 0;
  expect(
    CustomerArtworkPublicViewSchema.safeParse({
      purchaseId: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2027-01-01T00:00:00Z',
      artworkVersion: 0,
      slots: [slot],
      configurations: [
        {
          groupIndex: 0,
          productId: '111',
          revisionId: 'revision',
          slots: [slot],
          selectedSetup: { version: 'selected-product-setup-v1', methodBindings: {}, product: effective },
          contentHash: 'a'.repeat(64),
          geometry: {},
          variantIds: ['101'],
          positions: [],
        },
      ],
    }).success,
  ).toBe(false);
});

it('keeps short price identities stable and hashes the full tuple for long step/method identities', async () => {
  const { selectedPriceIdentity } = await import('./selected-product.js');
  expect(selectedPriceIdentity('chest:small', 'print')).toBe('price:chest:small:print');
  expect(selectedPriceIdentity('step_' + 'a'.repeat(64), 'm'.repeat(128))).toBe(
    'price_ab08ceba159571464ad97873139309f3a8828812491e77c2eaaaf0ba161e68aa',
  );
  expect(selectedPriceIdentity('step_' + 'a'.repeat(64), 'm'.repeat(127) + 'n')).not.toBe(
    selectedPriceIdentity('step_' + 'a'.repeat(64), 'm'.repeat(128)),
  );
  expect(() => selectedPriceIdentity('bad/id', 'print')).toThrow();
});

it('tuple separators cannot collide and retained publications resolve only their actual immutable binding', async () => {
  const { selectedStepIdentity, selectedPriceIdentity, readSelectedStepIdentity } = await import(
    './selected-product.js'
  );
  const first = selectedStepIdentity('a:b', 'c'),
    second = selectedStepIdentity('a', 'b:c');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^step_[a-f0-9]{64}$/);
  expect(second).toMatch(/^step_[a-f0-9]{64}$/);
  expect(selectedPriceIdentity('a:b:c:d', 'print')).not.toBe(selectedPriceIdentity('a:b:c', 'd:print'));
  expect(readSelectedStepIdentity('a:b', 'c', ['a:b:c'])).toBe('a:b:c');
  expect(readSelectedStepIdentity('a:b', 'c', [first])).toBe(first);
  expect(readSelectedStepIdentity('a:b', 'c', [second])).toBeNull();
  expect(readSelectedStepIdentity('a:b', 'c', [first, 'a:b:c'])).toBeNull();
});
