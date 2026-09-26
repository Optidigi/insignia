import assert from 'node:assert/strict';
import { test } from 'node:test';

// Integer interpretation of the principal-adjudicated native fixture receipt.
// This is an audit calculation, not a checkout-discount engine.
test('native 10% per-unit rounding explains the retained USD91 fixture', () => {
  const buckets = [
    { quantity: 2n, unitMinor: 3033n, observedDiscountMinor: 606n },
    { quantity: 1n, unitMinor: 3034n, observedDiscountMinor: 303n },
  ];
  const signedPreDiscountMinor = buckets.reduce((n, b) => n + b.quantity * b.unitMinor, 0n);
  assert.equal(signedPreDiscountMinor, 9100n);
  for (const bucket of buckets) {
    const perUnitDiscount = bucket.unitMinor * 10n / 100n;
    assert.equal(perUnitDiscount * bucket.quantity, bucket.observedDiscountMinor);
  }
  const observedDiscountMinor = buckets.reduce((n, b) => n + b.observedDiscountMinor, 0n);
  assert.equal(observedDiscountMinor, 909n);
  assert.equal(signedPreDiscountMinor - observedDiscountMinor, 8191n);
});
