import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyFromSeed, publicKeyFromHex } from '../../m0-004/ts/authorization.ts';
import { decodeHeader } from '../../m0-005/ts/whole-quote.ts';
import { issueFixtureQuote, type FixtureContext } from './fixture.ts';

const context: FixtureContext = {
  appGid: 'gid://shopify/App/429028933633',
  shopGid: 'gid://shopify/Shop/105501393179',
  installationGid: 'gid://shopify/AppInstallation/1054356963611',
  storeDomain: 'insignia-rewrite-dev.myshopify.com',
  smallVariantGid: 'gid://shopify/ProductVariant/123456789',
  largeVariantGid: 'gid://shopify/ProductVariant/123456790',
  currency: 'USD', country: 'US', marketId: '1', shopLocalDate: '2026-09-28',
  keyId: 60014, generationHex: '11'.repeat(16), epoch: 1,
  quoteHex: '22'.repeat(16), setHex: '33'.repeat(16),
};
const key = privateKeyFromSeed('01'.repeat(32));
const nonSigner = publicKeyFromHex('8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c');
const bytes = { ordinaryLines: 1, unresolvedManagedLines: 0,
  ordinaryPhysicalQuantity: 1, ordinaryUnitMinor: '2000',
  transformInputUpperBytes: 90_000, validationInputUpperBytes: 110_000 };

test('small case signs the exact four-unit real-variant 111.00 basket', () => {
  const result = issueFixtureQuote('small', context, bytes, key);
  assert.equal(result.status, 'ADMIT');
  if (result.status !== 'ADMIT') return;
  assert.equal(result.allocation.totalQuantity, 3);
  assert.equal(result.allocation.totalMinor, '9100');
  assert.deepEqual(result.allocation.buckets.map(b => [b.quantity, b.unitMinor]),
    [[1, '3034'], [2, '3033']]);
  assert.equal(result.expectedOrdinaryMinor, '2000');
  assert.equal(result.expectedBasketMinor, '11100');
  assert.equal(result.bounds.totalCartLines, 3);
  assert.equal(result.issued.envelope.length, 208);
  assert.deepEqual(result.issued.carriers.map(c => c.length), [30, 30]);
  assert.equal(decodeHeader(Buffer.from(result.issued.envelope, 'base64url').subarray(0, 92)).count, 2);
});

test('10 plus 190 and 32 plus 168 use complete signed subsets; bucket 33 is refused before signing', () => {
  for (const [kind, ordinary] of [['stress10', 190], ['stress32', 168]] as const) {
    const result = issueFixtureQuote(kind, context, { ...bytes, ordinaryLines: ordinary,
      ordinaryPhysicalQuantity: ordinary }, key);
    assert.equal(result.status, 'ADMIT');
    if (result.status === 'ADMIT') {
      assert.equal(result.allocation.buckets.length, kind === 'stress10' ? 10 : 32);
      assert.equal(result.bounds.totalCartLines, 200);
      assert.equal(result.issued.carriers.length, result.allocation.buckets.length);
    }
  }
  assert.deepEqual(issueFixtureQuote('stress33', context, { ...bytes, ordinaryLines: 167,
    ordinaryPhysicalQuantity: 167 }, nonSigner),
    { status: 'REJECT', reason: 'BUCKET_COUNT' });
});

test('operator context rejects a different app, store, installation, currency or nonnumeric variant', () => {
  for (const changed of [
    { appGid: 'gid://shopify/App/427859050497' },
    { shopGid: 'gid://shopify/Shop/999' },
    { installationGid: 'gid://shopify/AppInstallation/999' },
    { currency: 'JPY' },
    { smallVariantGid: 'gid://shopify/ProductVariant/abc' },
  ]) assert.throws(() => issueFixtureQuote('small', { ...context, ...changed }, bytes, key));
});

test('observed projection growth and unresolved managed lines refuse issuance', () => {
  assert.deepEqual(issueFixtureQuote('stress32', context, { ...bytes, ordinaryLines: 169,
    ordinaryPhysicalQuantity: 169 }, nonSigner),
    { status: 'REJECT', reason: 'CART_LINES' });
  assert.deepEqual(issueFixtureQuote('small', context, { ...bytes, unresolvedManagedLines: 1 }, nonSigner),
    { status: 'REJECT', reason: 'INCOMPLETE_CUSTOMIZED_SUBSET' });
});
