import { describe, expect, it } from 'vitest';
import { privateKeyFromSeed, publicKeyFromHex, issueToken, type Claims } from './authorization.ts';
import { shopLocalDayOrdinal, verifySet, type ExpectedContext, type PhysicalLine } from './verify-set.ts';

const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const publicKey = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const rotationSeed = '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
const rotationPublic = '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c';
const key = privateKeyFromSeed(seed);
const base: Claims = {
  keyId: 7, generationHex: '11'.repeat(16), epoch: 4,
  quoteHex: '22'.repeat(16), setHex: '33'.repeat(16), lineIndex: 0, lineCount: 2,
  variantId: '9007199254740993', quantity: 2, unitMinor: '3033',
  currency: 'EUR', exponent: 2, country: 'DE', marketId: '42',
  validThroughDay: 20802, totalQuantity: 3, totalMinor: '9100',
};
const second: Claims = { ...base, lineIndex: 1, quantity: 1, unitMinor: '3034' };
const token = (claim: Claims) => issueToken(claim, key, 20800);
const tamperSignature = (value: string): string => {
  const bytes = Buffer.from(value, 'base64url');
  bytes[114] = bytes[114]! ^ 1;
  return bytes.toString('base64url');
};
const line = (claim: Claims, overrides: Partial<PhysicalLine> = {}): PhysicalLine => ({
  variantId: claim.variantId, quantity: claim.quantity, observedUnitMinor: claim.unitMinor,
  token: token(claim), marked: true, requiresAuthorization: true, hasSellingPlan: false, ...overrides,
});
const context: ExpectedContext = {
  generationHex: base.generationHex, epoch: base.epoch, currency: 'EUR',
  country: 'DE', marketId: '42', allowNoMarket: false, shopLocalDay: 20802, maxBuckets: 64,
  maxPhysicalQuantity: 10_000, keys: new Map([[7, publicKeyFromHex(publicKey)]]),
};
const accepted = () => [line(base), line(second)];

describe('pure complete-set verifier with harness-supplied independent context', () => {
  it('accepts a complete set in either order with ordinary optional products', () => {
    expect(verifySet(accepted(), context)).toEqual({ accepted: true, bucketCount: 2, totalQuantity: 3, totalMinor: '9100' });
    expect(verifySet([...accepted().reverse(), {
      variantId: '9', quantity: 1, observedUnitMinor: '100', marked: false, requiresAuthorization: false, hasSellingPlan: false,
    }], context)).toEqual({ accepted: true, bucketCount: 2, totalQuantity: 3, totalMinor: '9100' });
  });

  it.each([
    ['missing', [line(base)]],
    ['duplicate', [line(base), line(base)]],
    ['extra', [...accepted(), line(base)]],
    ['mixed renewal', [line(base), line({ ...second, setHex: '44'.repeat(16) })]],
    ['mixed quote', [line(base), line({ ...second, quoteHex: '44'.repeat(16) })]],
    ['changed common total', [line(base), line({ ...second, totalMinor: '9101' })]],
    ['wrong observed quantity', [line(base, { quantity: 1 }), line(second)]],
    ['wrong observed variant', [line(base, { variantId: '12' }), line(second)]],
    ['wrong observed unit price', [line(base, { observedUnitMinor: '3034' }), line(second)]],
    ['ambiguous price', [line(base, { observedUnitMinor: undefined }), line(second)]],
    ['selling plan', [line(base, { hasSellingPlan: true }), line(second)]],
    ['bad signature near end', [line(base), line(second, { token: tamperSignature(token(second)) })]],
  ] as const)('rejects %s', (_name, lines) => {
    expect(() => verifySet(lines, context)).toThrow();
  });

  it('checks context from the independent harness input', () => {
    for (const changed of [
      { generationHex: 'ff'.repeat(16) }, { epoch: 5 }, { currency: 'USD' },
      { country: 'FR' }, { marketId: '43' }, { shopLocalDay: 20803 },
      { maxBuckets: 1 }, { maxPhysicalQuantity: 2 }, { keys: new Map() },
    ]) expect(() => verifySet(accepted(), { ...context, ...changed })).toThrow();
    expect(() => verifySet([line(base, { token: undefined }), line(second)], context)).toThrow();
    expect(() => verifySet(accepted(), { ...context, shopLocalDay: 20800 })).not.toThrow();
  });

  it('accepts only the fixed E-2 through E shop-local validity interval', () => {
    const one: Claims = { ...base, lineCount: 1, lineIndex: 0, quantity: 1,
      unitMinor: '100', totalQuantity: 1, totalMinor: '100' };
    const signed = (claim: Claims, issuanceDay: number): PhysicalLine => ({
      variantId: claim.variantId, quantity: claim.quantity, observedUnitMinor: claim.unitMinor,
      token: issueToken(claim, key, issuanceDay), marked: true,
      requiresAuthorization: true, hasSellingPlan: false,
    });
    const normal = signed(one, 20800);
    for (const day of [20800, 20801, 20802]) {
      expect(verifySet([normal], { ...context, shopLocalDay: day }).accepted).toBe(true);
    }
    for (const day of [20799, 20803]) {
      expect(() => verifySet([normal], { ...context, shopLocalDay: day })).toThrow();
    }
    const future = { ...one, validThroughDay: 20850 };
    expect(() => verifySet([signed(future, 20848)], { ...context, shopLocalDay: 20800 })).toThrow();
    const earliest = { ...one, validThroughDay: 2 };
    for (const day of [0, 1, 2]) {
      expect(verifySet([signed(earliest, 0)], { ...context, shopLocalDay: day }).accepted).toBe(true);
    }
    expect(() => verifySet([signed(earliest, 0)], { ...context, shopLocalDay: 3 })).toThrow();
    const latest = { ...one, validThroughDay: 0xffffffff };
    for (const day of [0xfffffffd, 0xfffffffe, 0xffffffff]) {
      expect(verifySet([signed(latest, 0xfffffffd)], { ...context, shopLocalDay: day }).accepted).toBe(true);
    }
    expect(() => verifySet([signed(latest, 0xfffffffd)], { ...context, shopLocalDay: 0xfffffffc })).toThrow();
    expect(() => verifySet([normal], { ...context, shopLocalDay: 0x100000000 })).toThrow();
  });

  it('allows separate complete sets during key overlap but rejects mixed-key members', () => {
    const rotatedFirst = { ...base, keyId: 8, setHex: '44'.repeat(16) };
    const rotatedSecond = { ...second, keyId: 8, setHex: '44'.repeat(16) };
    const keys = new Map([...context.keys, [8, publicKeyFromHex(rotationPublic)]]);
    const rotatedLines = [rotatedFirst, rotatedSecond].map(claim => line(claim, {
      token: issueToken(claim, privateKeyFromSeed(rotationSeed), 20800),
    }));
    expect(() => verifySet(accepted(), { ...context, keys })).not.toThrow();
    expect(() => verifySet(rotatedLines, { ...context, keys })).not.toThrow();
    expect(() => verifySet(rotatedLines, context)).toThrow();
    expect(() => verifySet([line(base), line(second, { token: issueToken({ ...second, keyId: 8 }, privateKeyFromSeed(rotationSeed), 20800) })], { ...context, keys })).toThrow();
  });

  it('rejects a 500-unit quote after an entire group is removed', () => {
    const first = { ...base, variantId: '10', quantity: 250, unitMinor: '2314', totalQuantity: 500, totalMinor: '1458500' };
    const other = { ...first, lineIndex: 1, variantId: '20', unitMinor: '3520' };
    const full = [line(first), line(other)];
    expect(verifySet(full, context).totalQuantity).toBe(500);
    expect(() => verifySet([full[0]!], context)).toThrow();
    expect(() => verifySet([line(first, { quantity: 10 }), line(other)], context)).toThrow();
  });

  it('rejects a required plain product, but permits a plain-only optional cart', () => {
    const plain = { variantId: '9', quantity: 1, observedUnitMinor: '100', marked: false, requiresAuthorization: false, hasSellingPlan: false };
    expect(verifySet([plain], context)).toEqual({ accepted: true, bucketCount: 0, totalQuantity: 0, totalMinor: '0' });
    expect(() => verifySet([{ ...plain, requiresAuthorization: true }], context)).toThrow();
    expect(() => verifySet([{ ...plain, marked: true }], context)).toThrow();
    expect(() => verifySet([line(base, { marked: false }), line(second)], context)).toThrow();
  });

  it('requires an explicitly supported no-market context', () => {
    const zeroMarket = { ...base, lineCount: 1, lineIndex: 0, quantity: 1, unitMinor: '100',
      totalQuantity: 1, totalMinor: '100', marketId: '0' };
    const actual = [line(zeroMarket)];
    expect(() => verifySet(actual, { ...context, marketId: '0' })).toThrow();
    expect(() => verifySet(actual, { ...context, marketId: '0', allowNoMarket: true })).not.toThrow();
  });

  it('rejects changed common totals and integer overflow without floating arithmetic', () => {
    const tooMany = line({ ...base, totalQuantity: 500, totalMinor: '9100' });
    expect(() => verifySet([tooMany, line({ ...second, totalQuantity: 500 })], context)).toThrow();
    const max = line({ ...base, unitMinor: '18446744073709551615', totalMinor: '18446744073709551615', quantity: 1 });
    expect(() => verifySet([max], context)).toThrow();
  });
});

describe('shop-local calendar day helper', () => {
  it('uses the shop timezone over spring and autumn DST boundaries', () => {
    const d = shopLocalDayOrdinal('2026-03-08T04:59:59Z', 'America/New_York');
    expect(shopLocalDayOrdinal('2026-03-08T05:00:00Z', 'America/New_York')).toBe(d + 1);
    expect(shopLocalDayOrdinal('2026-03-09T03:59:59Z', 'America/New_York')).toBe(d + 1);
    expect(shopLocalDayOrdinal('2026-03-09T04:00:00Z', 'America/New_York')).toBe(d + 2);
    const autumn = shopLocalDayOrdinal('2026-11-01T03:59:59Z', 'America/New_York');
    expect(shopLocalDayOrdinal('2026-11-01T04:00:00Z', 'America/New_York')).toBe(autumn + 1);
    expect(shopLocalDayOrdinal('2026-11-02T04:59:59Z', 'America/New_York')).toBe(autumn + 1);
    expect(shopLocalDayOrdinal('2026-11-02T05:00:00Z', 'America/New_York')).toBe(autumn + 2);
  });
});
