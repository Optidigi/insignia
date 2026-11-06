import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuyerDesiredGroup, SelectedProductSetup } from '@insignia/contracts';
import {
  type PositionValidationPorts,
  validateBuyerProductionPositions,
} from '../src/server/buyer/production-position.ts';

function fixture() {
  const selectedSetup: SelectedProductSetup = {
    version: 'selected-product-setup-v1',
    methodBindings: {},
    product: {
      id: '11',
      title: 'Shirt',
      images: [],
      methods: [{ id: 'print', name: 'Print', pricing: 'fixed', amount: '3.50' }],
      views: [
        {
          id: 'front',
          name: 'Front',
          imageUrl: 'https://assets.test/frozen.png',
          imageWidth: 1000,
          imageHeight: 1000,
          placements: [
            {
              id: 'chest',
              name: 'Chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
              widthCm: '20',
              heightCm: '20',
              methodIds: ['print'],
              sizes: [{ id: 'small', name: 'Small', widthPercent: '50', prices: {} }],
              logoLaterAllowed: true,
              customPlacementAllowed: true,
              movementRect: { centerX: 0.5, centerY: 0.5, width: 0.6, height: 0.6 },
            },
          ],
        },
      ],
    },
  };
  const group: BuyerDesiredGroup = {
    productId: '11',
    configRevisionId: 'revision',
    revisionContentHash: 'a'.repeat(64),
    design: {
      placements: [
        {
          placementId: 'chest',
          methodId: 'print',
          stepId: 'chest:small',
          artwork: { kind: 'revision', revisionId: 'asset' },
          position: { xMicros: 650000, yMicros: 500000 },
        },
      ],
      options: [],
    },
    variants: [{ variantId: '101', quantity: 2 }],
  };
  const ports: PositionValidationPorts = {
    presentation: async () => ({ selectedSetup }),
    geometry: async () => ({
      value: {
        version: 'm5-geometry-v1',
        views: [
          {
            id: 'front',
            image: { revisionId: 'photo', width: 1000, height: 1000 },
            variantImages: [],
            placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 } }],
          },
        ],
        steps: [{ id: 'chest:small', widthFraction: 0.5, heightFraction: 0.5 }],
      },
    }),
    artwork: async () => ({
      state: 'USABLE',
      expiresAt: new Date(Date.now() + 60000),
      manifest: { width: 200, height: 100 },
    }),
    now: () => new Date(),
  };
  return { group, ports, selectedSetup };
}
test('server permits allowed production movement and rejects a footprint outside the immutable movement area', async () => {
  const { group, ports } = fixture();
  await validateBuyerProductionPositions([group], ports);
  const selected = group.design.placements[0];
  assert(selected);
  selected.position = { xMicros: 750000, yMicros: 500000 };
  await assert.rejects(validateBuyerProductionPositions([group], ports), /outside allowed production area/);
});
test('movement requires merchant permission and usable owned artwork, not a browser-supplied center alone', async () => {
  const { group, ports, selectedSetup } = fixture();
  const placement = selectedSetup.product.views[0]?.placements[0];
  assert(placement);
  placement.customPlacementAllowed = false;
  await assert.rejects(validateBuyerProductionPositions([group], ports), /Movement not allowed/);
  placement.customPlacementAllowed = true;
  await assert.rejects(
    validateBuyerProductionPositions([group], { ...ports, artwork: async () => null }),
    /Production artwork unavailable/,
  );
});
test('old fixed-position groups need no new publication/asset lookup and retain their old semantics', async () => {
  const { group, ports } = fixture();
  delete group.design.placements[0]?.position;
  await validateBuyerProductionPositions([group], {
    ...ports,
    presentation: async () => {
      throw new Error('no lookup expected');
    },
  });
});
