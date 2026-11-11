import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admitCandidate, transformOutputUpperBytes } from '../src/admission.ts';

const members = (n: number, qty = 1) =>
  Array.from({ length: n }, (_, i) => ({ index: i, variantId: String(i + 1), quantity: qty, unitMinor: '100' }));
test('hard subset bounds and untrusted ordinary-line hints', () => {
  assert.equal(admitCandidate(members(10), { ordinaryLineHint: 190 }).status, 'ADMIT');
  assert.equal(admitCandidate(members(32), { ordinaryLineHint: 168 }).status, 'ADMIT');
  assert.deepEqual(admitCandidate(members(33), { ordinaryLineHint: 0 }), { status: 'REJECT', reason: 'BUCKET_COUNT' });
  assert.deepEqual(admitCandidate(members(10), { ordinaryLineHint: 191 }), { status: 'REJECT', reason: 'CART_LINES' });
  assert.equal(admitCandidate(members(5, 2000), { ordinaryLineHint: 0 }).status, 'ADMIT');
  assert.deepEqual(admitCandidate(members(5, 2001), { ordinaryLineHint: 0 }), {
    status: 'REJECT',
    reason: 'PHYSICAL_QUANTITY',
  });
  assert.equal(admitCandidate(members(1), { ordinaryLineHint: -1 }).status, 'REJECT');
  assert.ok(transformOutputUpperBytes(32) <= 16000);
});
test('33 lines are refused before the v3 signer is called', async () => {
  const { issueLineSetV3 } = await import('../src/line-v3.ts');
  let called = 0;
  const claims = {
    keyId: 7,
    generationHex: '11'.repeat(16),
    epoch: 4,
    quoteHex: '22'.repeat(16),
    setHex: '33'.repeat(16),
    currency: 'EUR',
    exponent: 2,
    country: 'DE',
    marketId: '42',
    validThroughDay: 20802,
  };
  await assert.rejects(
    issueLineSetV3(claims, members(33), 20800, {
      signWholeQuote: async () => {
        called++;
        throw Error('must not sign');
      },
    }),
  );
  assert.equal(called, 0);
});
test('transform output bound uses the short v3 child reference', () => {
  assert.equal(transformOutputUpperBytes(32), 11_312);
});
