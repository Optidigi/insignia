import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyFromSeed, publicKeyFromHex } from '../../m0-004/ts/authorization.ts';
import { allocateGroups, type AcceptedGroup } from '../../m0-004/ts/allocation.ts';
import { decodeHeader } from '../../m0-005/ts/whole-quote.ts';
import { decideAdmission, issueAdmittedQuote, transformOutputUpperBytes, type CapacityProfile } from './admission.ts';

// A test profile exercises the public seam. It is not a merchant capacity decision.
const profile: CapacityProfile = {
  id: 'synthetic-ten-case', maxCustomizedBuckets: 10, maxCartLines: 200,
  maxPhysicalQuantity: 10_000, maxTransformOutputBytes: 16_000,
  maxTransformInputBytes: 128_000, maxValidationInputBytes: 128_000,
};
const cart = { ordinaryLines: 190, unresolvedManagedLines: 0,
  transformInputUpperBytes: 87_686, validationInputUpperBytes: 99_132 };
const context = { keyId: 7, generationHex: '11'.repeat(16), epoch: 4,
  quoteHex: '22'.repeat(16), setHex: '33'.repeat(16), currency: 'EUR', exponent: 2,
  country: 'DE', marketId: '42', validThroughDay: 20804 };
const privateKey = privateKeyFromSeed('01'.repeat(32));
const publicKey = publicKeyFromHex('8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c');
const groups = (n: number, q = 1): AcceptedGroup[] => Array.from({ length: n }, (_, i) => ({
  groupId: `group-${i}`, setupMinor: '0', variants: [{ variantId: String(100 + i),
    quantity: q, acceptedBaseUnitMinor: '3000' }],
}));

test('admission signs the entire ten-bucket quote without changing the v2 carrier', () => {
  const result = issueAdmittedQuote(groups(10), context, privateKey, 20802, cart, profile);
  assert.equal(result.status, 'ADMIT');
  if (result.status !== 'ADMIT') return;
  assert.equal(result.issued.members.length, 10);
  assert.equal(result.issued.carriers.length, 10);
  assert.equal(decodeHeader(Buffer.from(result.issued.envelope, 'base64url').subarray(0, 92)).count, 10);
  assert.equal(result.allocation.totalMinor, '30000');
  assert.equal(result.bounds.totalCartLines, 200);
  assert.ok(result.bounds.transformOutputUpperBytes <= 16_000);
});

test('one extra bucket is rejected before signing; no partial quote is issued', () => {
  const outcome = issueAdmittedQuote(groups(11), context, publicKey, 20802,
    { ...cart, ordinaryLines: 189 }, profile);
  assert.deepEqual(outcome, { status: 'REJECT', reason: 'BUCKET_COUNT' });
});

test('source-bound 32 plus 168 evaluation admits the whole set and rejects bucket 33', () => {
  const evaluated = { ...profile, id: 'local-32-plus-168-only', maxCustomizedBuckets: 32 };
  const projected = { ...cart, ordinaryLines: 168,
    transformInputUpperBytes: 92_522, validationInputUpperBytes: 103_968 };
  const accepted = decideAdmission(groups(32), projected, evaluated);
  assert.equal(accepted.status, 'ADMIT');
  if (accepted.status === 'ADMIT') {
    assert.equal(accepted.bounds.totalCartLines, 200);
    assert.equal(accepted.allocation.buckets.length, 32);
  }
  assert.deepEqual(issueAdmittedQuote(groups(33), context, publicKey, 20802,
    { ...projected, ordinaryLines: 167 }, evaluated),
  { status: 'REJECT', reason: 'BUCKET_COUNT' });
});

test('a caller cannot raise the profile above the compiled Function guards', () => {
  const widerBuckets = { ...profile, maxCustomizedBuckets: 33,
    maxTransformOutputBytes: 20_000 };
  assert.deepEqual(issueAdmittedQuote(groups(33), context, publicKey, 20802,
    { ...cart, ordinaryLines: 167 }, widerBuckets),
  { status: 'REJECT', reason: 'INVALID_PROFILE' });
  const widerPhysical = { ...profile, maxPhysicalQuantity: 10_001 };
  assert.deepEqual(issueAdmittedQuote(groups(1, 10_001), context, publicKey, 20802,
    { ...cart, ordinaryLines: 0 }, widerPhysical),
  { status: 'REJECT', reason: 'INVALID_PROFILE' });
  assert.deepEqual(decideAdmission(groups(1), cart,
    { ...profile, maxTransformOutputBytes: 16_001 }),
  { status: 'REJECT', reason: 'INVALID_PROFILE' });
});

test('unresolved managed lines and ordinary-cart growth invalidate admission', () => {
  assert.deepEqual(decideAdmission(groups(10), { ...cart, unresolvedManagedLines: 1 }, profile),
    { status: 'REJECT', reason: 'INCOMPLETE_CUSTOMIZED_SUBSET' });
  assert.deepEqual(decideAdmission(groups(10), { ...cart, ordinaryLines: 191 }, profile),
    { status: 'REJECT', reason: 'CART_LINES' });
});

test('physical garment count is independent of bucket count and cannot be split to fit', () => {
  const large = groups(5, 2_000);
  const accepted = decideAdmission(large, { ...cart, ordinaryLines: 195 }, profile);
  assert.equal(accepted.status, 'ADMIT');
  if (accepted.status === 'ADMIT') assert.equal(accepted.allocation.totalQuantity, 10_000);
  assert.deepEqual(decideAdmission(groups(5, 2_001), { ...cart, ordinaryLines: 195 }, profile),
    { status: 'REJECT', reason: 'PHYSICAL_QUANTITY' });
});

test('the allocated bucket count, including setup remainder splits, is the admission unit', () => {
  const split: AcceptedGroup[] = [{
    groupId: 'setup-split', setupMinor: '1',
    variants: [{ variantId: '101', quantity: 2, acceptedBaseUnitMinor: '3000' }],
  }];
  const decision = decideAdmission(split, { ...cart, ordinaryLines: 198 },
    { ...profile, maxCustomizedBuckets: 2 });
  assert.equal(decision.status, 'ADMIT');
  if (decision.status === 'ADMIT') {
    assert.equal(decision.allocation.buckets.length, 2);
    assert.equal(decision.allocation.totalMinor, '6001');
    assert.equal(decision.bounds.totalCartLines, 200);
  }
  assert.deepEqual(decideAdmission(split, { ...cart, ordinaryLines: 198 },
    { ...profile, maxCustomizedBuckets: 1 }), { status: 'REJECT', reason: 'BUCKET_COUNT' });
});

test('the output bound uses the maximum admitted GID and amount widths', () => {
  assert.equal(transformOutputUpperBytes(32), 11_632); // Same serializer bound as Rust.
  assert.ok(transformOutputUpperBytes(64) > 16_000);
  const maximal = [{ groupId: 'max', setupMinor: '0', variants: [{
    variantId: '18446744073709551615', quantity: 1,
    acceptedBaseUnitMinor: '18446744073709551615',
  }] }];
  const allocation = allocateGroups(maximal);
  const upper = transformOutputUpperBytes(allocation.buckets.length);
  assert.ok(upper > 0);
  const limited = { ...profile, maxTransformOutputBytes: upper - 1 };
  assert.deepEqual(decideAdmission(maximal, { ...cart, ordinaryLines: 0 }, limited),
    { status: 'REJECT', reason: 'TRANSFORM_OUTPUT' });
  const pass = decideAdmission(maximal, { ...cart, ordinaryLines: 0 }, { ...limited, maxTransformOutputBytes: upper });
  assert.equal(pass.status, 'ADMIT');
});

test('source projection byte bounds are checked but are invalidated by later cart edits', () => {
  assert.deepEqual(decideAdmission(groups(1), { ...cart, transformInputUpperBytes: 128_001 }, profile),
    { status: 'REJECT', reason: 'TRANSFORM_INPUT' });
  assert.deepEqual(decideAdmission(groups(1), { ...cart, validationInputUpperBytes: 128_001 }, profile),
    { status: 'REJECT', reason: 'VALIDATION_INPUT' });
});
