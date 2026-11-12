import { generateKeyPairSync } from 'node:crypto';
import { admitCandidate } from '@insignia/cart-authorization';
import { BUYER_CART_CAPACITY } from '@insignia/contracts';
import { expect, test } from 'vitest';
import { buildPublicConfig } from '../src/keys/public-config.js';

const lines = (count: number, quantity = 1) => Array.from({ length: count }, (_, index) => ({ index, quantity }));

/** The buyer-facing cart limit, the published Function config and candidate admission must agree (#335). */
test('the buyer cart capacity equals the published Function limits and candidate admission', () => {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const config = JSON.parse(
    buildPublicConfig({
      scope: {
        shopId: 'shop',
        installationGeneration: '1',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 0,
      },
      keys: [{ id: 1, publicKey, state: 'active', firstDay: 1, lastDay: 2 }],
    }).value,
  );
  expect({ maxBuckets: config.maxBuckets, maxPhysicalQuantity: config.maxPhysicalQuantity }).toEqual({
    maxBuckets: BUYER_CART_CAPACITY.variants,
    maxPhysicalQuantity: BUYER_CART_CAPACITY.quantity,
  });
  const { variants, quantity, cartLines } = BUYER_CART_CAPACITY;
  const hint = { ordinaryLineHint: 0 };
  expect(admitCandidate(lines(variants), hint).status).toBe('ADMIT');
  expect(admitCandidate(lines(variants + 1), hint)).toEqual({ status: 'REJECT', reason: 'BUCKET_COUNT' });
  expect(admitCandidate([{ index: 0, quantity }], hint).status).toBe('ADMIT');
  expect(admitCandidate([{ index: 0, quantity: quantity + 1 }], hint)).toEqual({
    status: 'REJECT',
    reason: 'PHYSICAL_QUANTITY',
  });
  expect(admitCandidate(lines(1), { ordinaryLineHint: cartLines - 1 }).status).toBe('ADMIT');
  expect(admitCandidate(lines(1), { ordinaryLineHint: cartLines })).toEqual({ status: 'REJECT', reason: 'CART_LINES' });
});
