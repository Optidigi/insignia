import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReadPurchaseRecords } from '../src/server/purchase/access.ts';

test('privacy capability requires current verified order and artwork grants independently of product editing', () => {
  const authorized = { canReadOrders: true, canReadArtwork: true, expiresAtMs: 2000 };
  assert.equal(canReadPurchaseRecords(authorized, 1000), true);
  assert.equal(canReadPurchaseRecords({ ...authorized, canReadOrders: false }, 1000), false);
  assert.equal(canReadPurchaseRecords({ ...authorized, canReadArtwork: false }, 1000), false);
  assert.equal(canReadPurchaseRecords({ ...authorized, canReadOrders: undefined }, 1000), false);
  assert.equal(canReadPurchaseRecords({ ...authorized, canReadArtwork: undefined }, 1000), false);
  assert.equal(canReadPurchaseRecords({ ...authorized, expiresAtMs: 1000 }, 1000), false);
  assert.equal(canReadPurchaseRecords({ ...authorized, expiresAtMs: 999 }, 1000), false);
});
