import { type KeyObject, sign } from 'node:crypto';
import { currencyExponent } from './currency.ts';

export const DOMAIN = Buffer.from('Insignia\0WholeQuoteAuthorization\0v2\0', 'ascii');
export const HEADER_BYTES = 92;
export const MEMBER_BYTES = 22;
export const ENVELOPE_ATTRIBUTE = '_insignia_quote_v2';
export const MEMBER_ATTRIBUTE = '_insignia_member_v2';
const U32 = 0xffffffff;
const U64 = (1n << 64n) - 1n;
export interface Header {
  keyId: number;
  generationHex: string;
  epoch: number;
  quoteHex: string;
  setHex: string;
  count: number;
  currency: string;
  exponent: number;
  country: string;
  marketId: string;
  validThroughDay: number;
  totalQuantity: number;
  totalMinor: string;
}
export interface Member {
  index: number;
  variantId: string;
  quantity: number;
  unitMinor: string;
}
export interface SignWholeQuoteInput {
  message: Buffer;
  keyId: number;
  issuanceDay: number;
  validThroughDay: number;
  generationHex: string;
  epoch: number;
  quoteHex: string;
  setHex: string;
}
export interface SignWholeQuoteResult {
  keyId: number;
  publicKeyFingerprint: string;
  firstValidDay: number;
  lastValidDay: number;
  signature: Uint8Array;
}
export interface AuthorizationSigner {
  signWholeQuote(input: SignWholeQuoteInput): Promise<SignWholeQuoteResult>;
}
function unsigned(n: number, max: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`${name}: invalid unsigned integer`);
  return n;
}
function decimalU64(text: string, name: string): bigint {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${name}: invalid unsigned decimal`);
  const n = BigInt(text);
  if (n > U64) throw new Error(`${name}: u64 overflow`);
  return n;
}
function hex16(text: string, name: string): Buffer {
  if (typeof text !== 'string' || !/^[0-9a-f]{32}$/.test(text)) throw new Error(`${name}: invalid UUID bytes`);
  return Buffer.from(text, 'hex');
}
function checkHeader(h: Header): void {
  unsigned(h.keyId, 0xffff, 'key ID');
  hex16(h.generationHex, 'generation');
  unsigned(h.epoch, U32, 'epoch');
  hex16(h.quoteHex, 'quote');
  hex16(h.setHex, 'set');
  unsigned(h.count, 0xffff, 'count');
  if (h.count < 1 || h.count > 32) throw new Error('bucket count exceeds candidate guard');
  if (!/^[A-Z]{3}$/.test(h.currency) || currencyExponent(h.currency) !== h.exponent)
    throw new Error('unsupported currency/exponent');
  if (!/^[A-Z]{2}$/.test(h.country)) throw new Error('invalid country');
  decimalU64(h.marketId, 'market');
  unsigned(h.validThroughDay, U32, 'day');
  unsigned(h.totalQuantity, U32, 'quantity');
  if (h.totalQuantity < h.count || h.totalQuantity > 10000)
    throw new Error('physical quantity exceeds candidate guard');
  decimalU64(h.totalMinor, 'total minor');
}
function checkMember(m: Member): void {
  unsigned(m.index, 0xffff, 'index');
  if (decimalU64(m.variantId, 'variant') === 0n) throw new Error('zero variant');
  unsigned(m.quantity, U32, 'quantity');
  if (m.quantity === 0) throw new Error('zero quantity');
  decimalU64(m.unitMinor, 'unit minor');
}
export function encodeHeader(h: Header): Buffer {
  checkHeader(h);
  const b = Buffer.alloc(HEADER_BYTES);
  b.write('ISG2', 0, 'ascii');
  b[4] = 2;
  b.writeUInt16BE(h.keyId, 6);
  hex16(h.generationHex, 'generation').copy(b, 8);
  b.writeUInt32BE(h.epoch, 24);
  hex16(h.quoteHex, 'quote').copy(b, 28);
  hex16(h.setHex, 'set').copy(b, 44);
  b.writeUInt16BE(h.count, 60);
  b.write(h.currency, 62, 3, 'ascii');
  b[65] = h.exponent;
  b.write(h.country, 66, 2, 'ascii');
  b.writeBigUInt64BE(decimalU64(h.marketId, 'market'), 68);
  b.writeUInt32BE(h.validThroughDay, 76);
  b.writeUInt32BE(h.totalQuantity, 80);
  b.writeBigUInt64BE(decimalU64(h.totalMinor, 'total minor'), 84);
  return b;
}
export function decodeHeader(raw: Uint8Array): Header {
  const b = Buffer.from(raw);
  if (b.length !== HEADER_BYTES || !b.subarray(0, 4).equals(Buffer.from('ISG2')) || b[4] !== 2 || b[5] !== 0)
    throw new Error('invalid v2 header');
  if (![...b.subarray(62, 65), ...b.subarray(66, 68)].every((c) => c >= 65 && c <= 90))
    throw new Error('invalid uppercase header');
  const h: Header = {
    keyId: b.readUInt16BE(6),
    generationHex: b.subarray(8, 24).toString('hex'),
    epoch: b.readUInt32BE(24),
    quoteHex: b.subarray(28, 44).toString('hex'),
    setHex: b.subarray(44, 60).toString('hex'),
    count: b.readUInt16BE(60),
    currency: b.toString('ascii', 62, 65),
    exponent: b.readUInt8(65),
    country: b.toString('ascii', 66, 68),
    marketId: b.readBigUInt64BE(68).toString(),
    validThroughDay: b.readUInt32BE(76),
    totalQuantity: b.readUInt32BE(80),
    totalMinor: b.readBigUInt64BE(84).toString(),
  };
  checkHeader(h);
  return h;
}
export function encodeMember(m: Member): Buffer {
  checkMember(m);
  const b = Buffer.alloc(MEMBER_BYTES);
  b.writeUInt16BE(m.index, 0);
  b.writeBigUInt64BE(decimalU64(m.variantId, 'variant'), 2);
  b.writeUInt32BE(m.quantity, 10);
  b.writeBigUInt64BE(decimalU64(m.unitMinor, 'unit minor'), 14);
  return b;
}
export function decodeMember(raw: Uint8Array): Member {
  const b = Buffer.from(raw);
  if (b.length !== MEMBER_BYTES) throw new Error('invalid member length');
  const m = {
    index: b.readUInt16BE(0),
    variantId: b.readBigUInt64BE(2).toString(),
    quantity: b.readUInt32BE(10),
    unitMinor: b.readBigUInt64BE(14).toString(),
  };
  checkMember(m);
  return m;
}
function canonical(text: string, length: number, chars: number): Buffer {
  if (typeof text !== 'string' || text.length !== chars || !/^[A-Za-z0-9_-]+$/.test(text))
    throw new Error('invalid carrier');
  const raw = Buffer.from(text, 'base64url');
  if (raw.length !== length || raw.toString('base64url') !== text) throw new Error('noncanonical carrier');
  return raw;
}
export function decodeEnvelope(text: string): { header: Header; signature: Buffer } {
  const raw = canonical(text, 156, 208);
  return { header: decodeHeader(raw.subarray(0, 92)), signature: raw.subarray(92) };
}
export function decodeMemberCarrier(text: string): Member {
  return decodeMember(canonical(text, 22, 30));
}
export function checkCompleteSet(h: Header, members: readonly Member[]): void {
  checkHeader(h);
  if (members.length !== h.count) throw new Error('incomplete set');
  let qty = 0n,
    total = 0n;
  for (const [i, m] of members.entries()) {
    checkMember(m);
    if (m.index !== i) throw new Error('unordered/missing index');
    qty += BigInt(m.quantity);
    total += BigInt(m.quantity) * decimalU64(m.unitMinor, 'unit minor');
    if (qty > 10000n || total > U64) throw new Error('set overflow/quantity');
  }
  if (qty !== BigInt(h.totalQuantity) || total !== decimalU64(h.totalMinor, 'total minor'))
    throw new Error('set total mismatch');
}
export function wholeQuoteSignBytes(h: Header, members: readonly Member[]): Buffer {
  checkCompleteSet(h, members);
  return Buffer.concat([DOMAIN, encodeHeader(h), ...members.map(encodeMember)]);
}
export async function issueWholeQuote(
  h: Header,
  members: readonly Member[],
  issuanceDay: number,
  signer: AuthorizationSigner,
): Promise<{
  envelope: string;
  members: string[];
  keyId: number;
  publicKeyFingerprint: string;
  firstValidDay: number;
  lastValidDay: number;
}> {
  unsigned(issuanceDay, U32 - 2, 'issuance day');
  if (h.validThroughDay !== issuanceDay + 2) throw new Error('expiry must be D+2');
  checkCompleteSet(h, members);
  const records = members.map(encodeMember);
  const message = wholeQuoteSignBytes(h, members);
  const result = await signer.signWholeQuote({
    message,
    keyId: h.keyId,
    issuanceDay,
    validThroughDay: h.validThroughDay,
    generationHex: h.generationHex,
    epoch: h.epoch,
    quoteHex: h.quoteHex,
    setHex: h.setHex,
  });
  if (
    result.keyId !== h.keyId ||
    !result.publicKeyFingerprint ||
    !Number.isSafeInteger(result.firstValidDay) ||
    !Number.isSafeInteger(result.lastValidDay) ||
    result.firstValidDay < 0 ||
    result.lastValidDay > U32 ||
    result.firstValidDay > result.lastValidDay ||
    result.firstValidDay > issuanceDay ||
    result.lastValidDay < h.validThroughDay
  )
    throw new Error('signer key validity does not cover D..D+2');
  if (!(result.signature instanceof Uint8Array) || result.signature.length !== 64)
    throw new Error('invalid Ed25519 signature');
  return {
    envelope: Buffer.concat([encodeHeader(h), Buffer.from(result.signature)]).toString('base64url'),
    members: records.map((b) => b.toString('base64url')),
    keyId: result.keyId,
    publicKeyFingerprint: result.publicKeyFingerprint,
    firstValidDay: result.firstValidDay,
    lastValidDay: result.lastValidDay,
  };
}
/** Adapter for an injected private-key provider; no key storage or key generation. */
export class InjectedEd25519Signer implements AuthorizationSigner {
  private readonly provider: {
    getSigningKey(input: SignWholeQuoteInput): Promise<{
      key: KeyObject;
      keyId: number;
      publicKeyFingerprint: string;
      revoked: boolean;
      firstValidDay: number;
      lastValidDay: number;
    }>;
  };
  constructor(provider: {
    getSigningKey(input: SignWholeQuoteInput): Promise<{
      key: KeyObject;
      keyId: number;
      publicKeyFingerprint: string;
      revoked: boolean;
      firstValidDay: number;
      lastValidDay: number;
    }>;
  }) {
    this.provider = provider;
  }
  async signWholeQuote(input: SignWholeQuoteInput): Promise<SignWholeQuoteResult> {
    const k = await this.provider.getSigningKey(input);
    if (k.key.type !== 'private' || k.key.asymmetricKeyType !== 'ed25519')
      throw new Error('Ed25519 private key required');
    if (
      k.keyId !== input.keyId ||
      !k.publicKeyFingerprint ||
      k.revoked !== false ||
      !Number.isSafeInteger(k.firstValidDay) ||
      !Number.isSafeInteger(k.lastValidDay) ||
      k.firstValidDay < 0 ||
      k.lastValidDay > U32 ||
      k.firstValidDay > input.issuanceDay ||
      k.lastValidDay < input.validThroughDay
    )
      throw new Error('signer key validity does not cover D..D+2');
    return {
      keyId: k.keyId,
      publicKeyFingerprint: k.publicKeyFingerprint,
      firstValidDay: k.firstValidDay,
      lastValidDay: k.lastValidDay,
      signature: sign(null, input.message, k.key),
    };
  }
}
