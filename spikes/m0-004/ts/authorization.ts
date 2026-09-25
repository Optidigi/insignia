import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const PAYLOAD_BYTES = 114;
export const TOKEN_BYTES = 178;
export const TOKEN_CHARACTERS = 238;
export const SIGNING_PREFIX = Buffer.from('Insignia\0CartAuthorization\0v1\0', 'ascii');
const MAGIC = Buffer.from([0x49, 0x53, 0x47, 0x31]);
const U64_MAX = (1n << 64n) - 1n;

// This versioned mathematical table is for local vectors, not a statement of
// which currencies Shopify supports for a particular shop/market.
export const CURRENCY_EXPONENT_V1: Readonly<Record<string, number>> = Object.freeze({
  EUR: 2,
  USD: 2,
  JPY: 0,
  KWD: 3,
});

export interface Claims {
  keyId: number;
  generationHex: string;
  epoch: number;
  quoteHex: string;
  setHex: string;
  lineIndex: number;
  lineCount: number;
  variantId: string;
  quantity: number;
  unitMinor: string;
  currency: string;
  exponent: number;
  country: string;
  marketId: string;
  validThroughDay: number;
  totalQuantity: number;
  totalMinor: string;
}

function unsigned(value: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${name}: expected unsigned integer <= ${max}`);
  }
  return value;
}

export function decimalU64(value: string, name: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name}: expected canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) throw new Error(`${name}: u64 overflow`);
  return parsed;
}

function uuidBytes(value: string, name: string): Buffer {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
    throw new Error(`${name}: expected 16 lowercase hex bytes`);
  }
  return Buffer.from(value, 'hex');
}

function checkedClaims(value: Claims): Claims {
  unsigned(value.keyId, 0xffff, 'keyId');
  uuidBytes(value.generationHex, 'generationHex');
  unsigned(value.epoch, 0xffffffff, 'epoch');
  uuidBytes(value.quoteHex, 'quoteHex');
  uuidBytes(value.setHex, 'setHex');
  unsigned(value.lineIndex, 0xffff, 'lineIndex');
  unsigned(value.lineCount, 0xffff, 'lineCount');
  if (value.lineCount === 0 || value.lineIndex >= value.lineCount) throw new Error('invalid bucket index/count');
  if (decimalU64(value.variantId, 'variantId') === 0n) throw new Error('zero variant ID');
  unsigned(value.quantity, 0xffffffff, 'quantity');
  if (value.quantity === 0) throw new Error('zero bucket quantity');
  decimalU64(value.unitMinor, 'unitMinor');
  if (!/^[A-Z]{3}$/.test(value.currency) || CURRENCY_EXPONENT_V1[value.currency] !== value.exponent) {
    throw new Error('unsupported currency/exponent pair');
  }
  if (!/^[A-Z]{2}$/.test(value.country)) throw new Error('country: expected uppercase ISO alpha-2');
  decimalU64(value.marketId, 'marketId');
  unsigned(value.validThroughDay, 0xffffffff, 'validThroughDay');
  unsigned(value.totalQuantity, 0xffffffff, 'totalQuantity');
  if (value.totalQuantity < value.quantity) throw new Error('bucket exceeds quote quantity');
  const totalMinor = decimalU64(value.totalMinor, 'totalMinor');
  if (BigInt(value.quantity) * decimalU64(value.unitMinor, 'unitMinor') > totalMinor) {
    throw new Error('bucket exceeds quote total');
  }
  return value;
}

export function encodePayload(value: Claims): Buffer {
  const c = checkedClaims(value);
  const out = Buffer.alloc(PAYLOAD_BYTES);
  out.write('ISG1', 0, 'ascii');
  out.writeUInt8(1, 4);
  out.writeUInt8(0, 5);
  out.writeUInt16BE(c.keyId, 6);
  uuidBytes(c.generationHex, 'generationHex').copy(out, 8);
  out.writeUInt32BE(c.epoch, 24);
  uuidBytes(c.quoteHex, 'quoteHex').copy(out, 28);
  uuidBytes(c.setHex, 'setHex').copy(out, 44);
  out.writeUInt16BE(c.lineIndex, 60);
  out.writeUInt16BE(c.lineCount, 62);
  out.writeBigUInt64BE(decimalU64(c.variantId, 'variantId'), 64);
  out.writeUInt32BE(c.quantity, 72);
  out.writeBigUInt64BE(decimalU64(c.unitMinor, 'unitMinor'), 76);
  out.write(c.currency, 84, 3, 'ascii');
  out.writeUInt8(c.exponent, 87);
  out.write(c.country, 88, 2, 'ascii');
  out.writeBigUInt64BE(decimalU64(c.marketId, 'marketId'), 90);
  out.writeUInt32BE(c.validThroughDay, 98);
  out.writeUInt32BE(c.totalQuantity, 102);
  out.writeBigUInt64BE(decimalU64(c.totalMinor, 'totalMinor'), 106);
  return out;
}

export function decodePayload(payload: Uint8Array): Claims {
  const b = Buffer.from(payload);
  if (b.length !== PAYLOAD_BYTES || !b.subarray(0, 4).equals(MAGIC)) throw new Error('bad payload length/magic');
  if (b.readUInt8(4) !== 1 || b.readUInt8(5) !== 0) throw new Error('unsupported version/flags');
  if (![...b.subarray(84, 87), ...b.subarray(88, 90)].every(byte => byte >= 65 && byte <= 90)) {
    throw new Error('currency/country must contain raw uppercase ASCII bytes');
  }
  const value: Claims = {
    keyId: b.readUInt16BE(6),
    generationHex: b.subarray(8, 24).toString('hex'),
    epoch: b.readUInt32BE(24),
    quoteHex: b.subarray(28, 44).toString('hex'),
    setHex: b.subarray(44, 60).toString('hex'),
    lineIndex: b.readUInt16BE(60),
    lineCount: b.readUInt16BE(62),
    variantId: b.readBigUInt64BE(64).toString(),
    quantity: b.readUInt32BE(72),
    unitMinor: b.readBigUInt64BE(76).toString(),
    currency: b.toString('ascii', 84, 87),
    exponent: b.readUInt8(87),
    country: b.toString('ascii', 88, 90),
    marketId: b.readBigUInt64BE(90).toString(),
    validThroughDay: b.readUInt32BE(98),
    totalQuantity: b.readUInt32BE(102),
    totalMinor: b.readBigUInt64BE(106).toString(),
  };
  return checkedClaims(value);
}

function rawKey(hex: string, name: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`${name}: expected 32 lowercase hex bytes`);
  return Buffer.from(hex, 'hex');
}

export function privateKeyFromSeed(seedHex: string): KeyObject {
  // RFC 8410 PKCS#8 OneAsymmetricKey prefix for a 32-byte Ed25519 seed.
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), rawKey(seedHex, 'seed')]);
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
}

export function publicKeyFromHex(publicHex: string): KeyObject {
  // RFC 8410 SubjectPublicKeyInfo prefix for a 32-byte Ed25519 public key.
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey(publicHex, 'public key')]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

export function issueToken(claims: Claims, key: KeyObject, issuanceDay: number): string {
  unsigned(issuanceDay, 0xffffffff - 2, 'issuanceDay');
  if (claims.validThroughDay !== issuanceDay + 2) {
    throw new Error('authorization must expire at issuance day D+2');
  }
  const payload = encodePayload(claims);
  const signature = sign(null, Buffer.concat([SIGNING_PREFIX, payload]), key);
  if (signature.length !== 64) throw new Error('unexpected signature length');
  const token = Buffer.concat([payload, signature]).toString('base64url');
  if (token.length !== TOKEN_CHARACTERS) throw new Error('unexpected token character length');
  return token;
}

export function decodeAndVerifyToken(token: string, keys: ReadonlyMap<number, KeyObject>): Claims {
  if (typeof token !== 'string' || token.length !== TOKEN_CHARACTERS || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('invalid token alphabet/length');
  }
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== TOKEN_BYTES || bytes.toString('base64url') !== token) {
    throw new Error('noncanonical token encoding');
  }
  const payload = bytes.subarray(0, PAYLOAD_BYTES);
  const claims = decodePayload(payload);
  const key = keys.get(claims.keyId);
  if (!key) throw new Error('unknown key ID');
  if (!verify(null, Buffer.concat([SIGNING_PREFIX, payload]), key, bytes.subarray(PAYLOAD_BYTES))) {
    throw new Error('invalid signature');
  }
  return claims;
}
