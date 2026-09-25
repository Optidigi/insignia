import { describe, expect, it } from 'vitest';
import { privateKeyFromSeed, publicKeyFromHex } from './authorization.ts';
import { allocateGroups } from './allocation.ts';
import { issueAllocatedQuote, type QuoteContext } from './issue-allocation.ts';
import { verifySet, type ExpectedContext } from './verify-set.ts';

const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const publicKey = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const quote: QuoteContext = {
  keyId: 7, generationHex: '11'.repeat(16), epoch: 4,
  quoteHex: '22'.repeat(16), setHex: '33'.repeat(16),
  currency: 'EUR', exponent: 2, country: 'DE', marketId: '42', validThroughDay: 20802,
};
const expected: ExpectedContext = {
  generationHex: quote.generationHex, epoch: quote.epoch, currency: quote.currency,
  country: quote.country, marketId: quote.marketId, allowNoMarket: false,
  shopLocalDay: 20802, maxBuckets: 64, maxPhysicalQuantity: 10_000,
  keys: new Map([[7, publicKeyFromHex(publicKey)]]),
};

describe('allocation to signed complete-set seam', () => {
  it('issues the EUR 91 buckets with unique quote-global indexes and exact totals', () => {
    const allocation = allocateGroups([{ groupId: 'g', setupMinor: '100', variants: [
      { variantId: '9007199254740993', quantity: 3, acceptedBaseUnitMinor: '3000' },
    ] }]);
    const issued = issueAllocatedQuote(allocation, quote, privateKeyFromSeed(seed), 20800);
    expect(issued.map(x => [x.claims.lineIndex, x.claims.lineCount, x.claims.quantity, x.claims.unitMinor])).toEqual([
      [0, 2, 1, '3034'], [1, 2, 2, '3033'],
    ]);
    expect(issued.every(x => x.claims.totalQuantity === 3 && x.claims.totalMinor === '9100')).toBe(true);
    const lines = issued.map(x => ({ variantId: x.bucket.variantId, quantity: x.bucket.quantity,
      observedUnitMinor: x.bucket.unitMinor, token: x.token, marked: true,
      requiresAuthorization: true, hasSellingPlan: false }));
    expect(verifySet(lines, expected)).toEqual({ accepted: true, bucketCount: 2, totalQuantity: 3, totalMinor: '9100' });
    expect(() => verifySet(lines.slice(1), expected)).toThrow();
  });
});
