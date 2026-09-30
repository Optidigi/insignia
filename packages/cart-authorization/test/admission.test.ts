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
test('33 buckets are refused before the signer is called', async () => {
  const { issueAdmittedQuote } = await import('../src/admission.ts');
  let called = 0;
  const oversized = members(33);
  const header = {
    keyId: 7,
    generationHex: '11'.repeat(16),
    epoch: 4,
    quoteHex: '22'.repeat(16),
    setHex: '33'.repeat(16),
    count: 33,
    currency: 'EUR',
    exponent: 2,
    country: 'DE',
    marketId: '42',
    validThroughDay: 20802,
    totalQuantity: 33,
    totalMinor: '3300',
  };
  const outcome = await issueAdmittedQuote(
    header,
    oversized,
    20800,
    {
      signWholeQuote: async () => {
        called++;
        throw Error('must not sign');
      },
    },
    { ordinaryLineHint: 0 },
  );
  assert.deepEqual(outcome, { status: 'REJECT', reason: 'BUCKET_COUNT' });
  assert.equal(called, 0);
});
