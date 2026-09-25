import { describe, expect, it } from 'vitest';
import {
  decodeAndVerifyToken,
  encodePayload,
  issueToken,
  privateKeyFromSeed,
  publicKeyFromHex,
  type Claims,
} from './authorization.ts';

// RFC 8032 test case 1. Public test key, never a shop signing key.
const seedHex = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const publicHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

const claims: Claims = {
  keyId: 7,
  generationHex: '00'.repeat(16),
  epoch: 2,
  quoteHex: '11'.repeat(16),
  setHex: '22'.repeat(16),
  lineIndex: 0,
  lineCount: 1,
  variantId: '9007199254740993',
  quantity: 3,
  unitMinor: '3000',
  currency: 'EUR',
  exponent: 2,
  country: 'DE',
  marketId: '42',
  validThroughDay: 20800,
  totalQuantity: 3,
  totalMinor: '9000',
};

describe('candidate authorization bytes', () => {
  it('writes the 114 plan bytes with big-endian wide integers', () => {
    const expectedHex = [
      '49534731', '01', '00', '0007', '00'.repeat(16), '00000002',
      '11'.repeat(16), '22'.repeat(16), '0000', '0001',
      '0020000000000001', '00000003', '0000000000000bb8',
      '455552', '02', '4445', '000000000000002a',
      '00005140', '00000003', '0000000000002328',
    ].join('');
    expect(encodePayload(claims).toString('hex')).toBe(expectedHex);
    expect(expectedHex).toHaveLength(228);
  });

  it('signs a canonical 238-character token and verifies with the public key', () => {
    const token = issueToken(claims, privateKeyFromSeed(seedHex), 20798);
    expect(token).toHaveLength(238);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAndVerifyToken(token, new Map([[7, publicKeyFromHex(publicHex)]]))).toEqual(claims);
    expect(() => decodeAndVerifyToken(`${token.slice(0, -1)}B`, new Map([[7, publicKeyFromHex(publicHex)]]))).toThrow();
  });

  it('rejects an unsafe numeric representation of a u64 claim', () => {
    expect(() => encodePayload({ ...claims, variantId: Number(claims.variantId) as unknown as string })).toThrow();
    expect(() => encodePayload({ ...claims, totalMinor: '18446744073709551616' })).toThrow();
  });

  it('rejects a weak key and noncanonical Ed25519 S scalar', () => {
    const original = Buffer.from(issueToken(claims, privateKeyFromSeed(seedHex), 20798), 'base64url');
    const weak = new Map([[7, publicKeyFromHex('00'.repeat(32))]]);
    expect(() => decodeAndVerifyToken(original.toString('base64url'), weak)).toThrow();
    const normal = new Map([[7, publicKeyFromHex(publicHex)]]);
    expect(() => decodeAndVerifyToken(original.toString('base64url'), normal)).not.toThrow();
    const orderL = Buffer.from('edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010', 'hex');
    const originalR = Buffer.from(original.subarray(114, 146));
    let carry = 0;
    for (let i = 0; i < 32; i++) {
      const sum = original[146 + i]! + orderL[i]! + carry;
      original[146 + i] = sum & 0xff;
      carry = sum >> 8;
    }
    expect(carry).toBe(0);
    expect(original.subarray(114, 146)).toEqual(originalR);
    expect(() => decodeAndVerifyToken(original.toString('base64url'), normal)).toThrow('invalid signature');
  });

  it('bounds issuance to three shop-local calendar days and rejects zero variant IDs', () => {
    const key = privateKeyFromSeed(seedHex);
    expect(() => issueToken({ ...claims, validThroughDay: 0xffffffff }, key, 20800)).toThrow();
    expect(() => issueToken({ ...claims, validThroughDay: 20801 }, key, 20800)).toThrow();
    expect(() => issueToken(claims, key, 0xffffffff)).toThrow();
    expect(() => issueToken({ ...claims, variantId: '0' }, key, 20798)).toThrow();
  });
});
