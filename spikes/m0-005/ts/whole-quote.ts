import { sign, type KeyObject } from 'node:crypto';
import { allocateGroups, type AcceptedGroup } from '../../m0-004/ts/allocation.ts';
import { CURRENCY_EXPONENT_V1, decimalU64 } from '../../m0-004/ts/authorization.ts';

export const DOMAIN = Buffer.from('Insignia\0WholeQuoteAuthorization\0v2\0', 'ascii');
export const HEADER_BYTES = 92;
export const MEMBER_BYTES = 22;
export const ENVELOPE_CHARACTERS = 208;
const U32 = 0xffffffff;
const U64 = (1n << 64n) - 1n;
export interface Header {
  keyId: number; generationHex: string; epoch: number; quoteHex: string; setHex: string;
  count: number; currency: string; exponent: number; country: string; marketId: string;
  validThroughDay: number; totalQuantity: number; totalMinor: string;
}
export interface Member { index: number; variantId: string; quantity: number; unitMinor: string }
function uint(n: number, max: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`${name}: invalid unsigned integer`);
  return n;
}
function uuid(hex: string, name: string): Buffer {
  if (typeof hex !== 'string' || !/^[0-9a-f]{32}$/.test(hex)) throw new Error(`${name}: invalid lowercase UUID bytes`);
  return Buffer.from(hex, 'hex');
}
function positiveU64(text: string, name: string): bigint {
  const n = decimalU64(text, name);
  if (n === 0n) throw new Error(`${name}: zero`);
  return n;
}
function checkHeader(h: Header): Header {
  uint(h.keyId, 0xffff, 'key ID'); uuid(h.generationHex, 'generation');
  uint(h.epoch, U32, 'epoch'); uuid(h.quoteHex, 'quote'); uuid(h.setHex, 'set');
  uint(h.count, 0xffff, 'member count');
  if (h.count === 0) throw new Error('empty set');
  if (typeof h.currency !== 'string' || !/^[A-Z]{3}$/.test(h.currency) ||
      CURRENCY_EXPONENT_V1[h.currency] !== h.exponent) throw new Error('unsupported currency/exponent');
  if (typeof h.country !== 'string' || !/^[A-Z]{2}$/.test(h.country)) throw new Error('invalid country');
  decimalU64(h.marketId, 'market ID'); uint(h.validThroughDay, U32, 'expiry');
  uint(h.totalQuantity, U32, 'total quantity');
  if (h.totalQuantity === 0 || h.count > h.totalQuantity) throw new Error('impossible quantity/count');
  decimalU64(h.totalMinor, 'total minor');
  return h;
}
function checkMember(m: Member): Member {
  uint(m.index, 0xffff, 'index'); positiveU64(m.variantId, 'variant ID');
  uint(m.quantity, U32, 'quantity');
  if (m.quantity === 0) throw new Error('zero member quantity');
  decimalU64(m.unitMinor, 'unit minor');
  return m;
}

export function encodeHeader(header: Header): Buffer {
  const h = checkHeader(header), b = Buffer.alloc(HEADER_BYTES);
  b.write('ISG2', 0, 'ascii'); b[4] = 2; b.writeUInt16BE(h.keyId, 6);
  uuid(h.generationHex, 'generation').copy(b, 8); b.writeUInt32BE(h.epoch, 24);
  uuid(h.quoteHex, 'quote').copy(b, 28); uuid(h.setHex, 'set').copy(b, 44);
  b.writeUInt16BE(h.count, 60); b.write(h.currency, 62, 3, 'ascii'); b[65] = h.exponent;
  b.write(h.country, 66, 2, 'ascii'); b.writeBigUInt64BE(decimalU64(h.marketId, 'market ID'), 68);
  b.writeUInt32BE(h.validThroughDay, 76); b.writeUInt32BE(h.totalQuantity, 80);
  b.writeBigUInt64BE(decimalU64(h.totalMinor, 'total minor'), 84);
  return b;
}
export function decodeHeader(bytes: Uint8Array): Header {
  const b = Buffer.from(bytes);
  if (b.length !== HEADER_BYTES || !b.subarray(0, 4).equals(Buffer.from('ISG2')) || b[4] !== 2 || b[5] !== 0) {
    throw new Error('bad v2 header length/magic/version/flags');
  }
  if (![...b.subarray(62, 65), ...b.subarray(66, 68)].every(c => c >= 65 && c <= 90)) {
    throw new Error('raw header is not uppercase ASCII');
  }
  return checkHeader({ keyId: b.readUInt16BE(6), generationHex: b.subarray(8, 24).toString('hex'),
    epoch: b.readUInt32BE(24), quoteHex: b.subarray(28, 44).toString('hex'),
    setHex: b.subarray(44, 60).toString('hex'), count: b.readUInt16BE(60),
    currency: b.toString('ascii', 62, 65), exponent: b[65]!, country: b.toString('ascii', 66, 68),
    marketId: b.readBigUInt64BE(68).toString(), validThroughDay: b.readUInt32BE(76),
    totalQuantity: b.readUInt32BE(80), totalMinor: b.readBigUInt64BE(84).toString() });
}
export function encodeMember(member: Member): Buffer {
  const m = checkMember(member), b = Buffer.alloc(MEMBER_BYTES);
  b.writeUInt16BE(m.index, 0); b.writeBigUInt64BE(decimalU64(m.variantId, 'variant ID'), 2);
  b.writeUInt32BE(m.quantity, 10); b.writeBigUInt64BE(decimalU64(m.unitMinor, 'unit minor'), 14);
  return b;
}
export function decodeMember(bytes: Uint8Array): Member {
  const b = Buffer.from(bytes);
  if (b.length !== MEMBER_BYTES) throw new Error('bad member length');
  return checkMember({ index: b.readUInt16BE(0), variantId: b.readBigUInt64BE(2).toString(),
    quantity: b.readUInt32BE(10), unitMinor: b.readBigUInt64BE(14).toString() });
}
function checkSet(header: Header, members: readonly Member[]): void {
  if (members.length !== header.count) throw new Error('incomplete set');
  let quantity = 0n, amount = 0n;
  for (let index = 0; index < members.length; index++) {
    const member = checkMember(members[index]!);
    if (member.index !== index) throw new Error('unordered/missing index');
    quantity += BigInt(member.quantity);
    amount += BigInt(member.quantity) * decimalU64(member.unitMinor, 'unit minor');
    if (quantity > BigInt(U32) || amount > U64) throw new Error('set overflow');
  }
  if (quantity !== BigInt(header.totalQuantity) || amount !== decimalU64(header.totalMinor, 'total minor')) {
    throw new Error('set total mismatch');
  }
}
export function issueWholeQuote(header: Header, members: readonly Member[], key: KeyObject, issuanceDay: number): { envelope: string; members: string[] } {
  uint(issuanceDay, U32 - 2, 'issuance day');
  if (header.validThroughDay !== issuanceDay + 2) throw new Error('expiry must be D+2');
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new Error('issuer requires an Ed25519 private key');
  const head = encodeHeader(header); checkSet(header, members);
  const records = members.map(encodeMember);
  const signature = sign(null, Buffer.concat([DOMAIN, head, ...records]), key);
  if (signature.length !== 64) throw new Error('bad Ed25519 signature length');
  return { envelope: Buffer.concat([head, signature]).toString('base64url'),
    members: records.map(record => record.toString('base64url')) };
}

/** Assign quote-global indexes after the unchanged M0-004 exact-money allocator. */
export function issueAllocatedQuote(
  groups: readonly AcceptedGroup[], context: Omit<Header, 'count' | 'totalQuantity' | 'totalMinor'>,
  key: KeyObject, issuanceDay: number,
): { header: Header; members: Member[]; envelope: string; carriers: string[] } {
  const allocation = allocateGroups(groups);
  const header: Header = { ...context, count: allocation.buckets.length,
    totalQuantity: allocation.totalQuantity, totalMinor: allocation.totalMinor };
  const members = allocation.buckets.map((bucket, index) => ({
    index, variantId: bucket.variantId, quantity: bucket.quantity, unitMinor: bucket.unitMinor,
  }));
  const issued = issueWholeQuote(header, members, key, issuanceDay);
  return { header, members, envelope: issued.envelope, carriers: issued.members };
}
