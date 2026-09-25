import { sign, verify, type KeyObject } from 'node:crypto';
import { allocateGroups, parseMinor, type AcceptedGroup } from '../../m0-004/ts/allocation.ts';
import { CURRENCY_EXPONENT_V1, decimalU64 } from '../../m0-004/ts/authorization.ts';

export const DOMAIN = Buffer.from('Insignia\0WholeQuoteAuthorization\0v2\0', 'ascii');
export const HEADER_BYTES = 92;
export const MEMBER_BYTES = 22;
export const ENVELOPE_CHARACTERS = 208;
const U32 = 0xffffffff;
const U64 = (1n << 64n) - 1n;
const ED_ORDER = BigInt('0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed');
const FIELD = (1n << 255n) - 19n;
// Canonical compressed eight-torsion encodings, as checked against dalek's
// EIGHT_TORSION constants: https://docs.rs/brine-ed25519/latest/src/brine_ed25519/lib.rs.html
const WEAK_POINTS = new Set([
  `01${'00'.repeat(31)}`,
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  `${'00'.repeat(31)}80`,
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  `ec${'ff'.repeat(30)}7f`,
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
  '00'.repeat(32),
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
]);

export interface Header {
  keyId: number; generationHex: string; epoch: number; quoteHex: string; setHex: string;
  count: number; currency: string; exponent: number; country: string; marketId: string;
  validThroughDay: number; totalQuantity: number; totalMinor: string;
}
export interface Member { index: number; variantId: string; quantity: number; unitMinor: string }
export interface PhysicalLine {
  variantId: string; quantity: number; observedSubtotal?: string | undefined; member?: string | undefined;
  marked: boolean; requiresAuthorization: boolean; hasSellingPlan: boolean;
}
export interface VerificationKey { publicKey: KeyObject; revoked: boolean; firstDay: number; lastDay: number }
export interface TrustedContext {
  generationHex: string; epoch: number; currency: string; exponent: number; country: string;
  marketId: string; allowNoMarket: boolean; shopLocalDay: number; maxBuckets: number;
  maxPhysicalQuantity: number; keys: ReadonlyMap<number, VerificationKey>;
}
export interface PhysicalCart { envelope?: string | undefined; lines: readonly PhysicalLine[] }
export interface SetDecision { accepted: true; bucketCount: number; totalQuantity: number; totalMinor: string }

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
function carrier(value: string, chars: number, bytes: number): Buffer {
  if (typeof value !== 'string' || value.length !== chars || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('bad carrier alphabet/length');
  }
  const b = Buffer.from(value, 'base64url');
  if (b.length !== bytes || b.toString('base64url') !== value) throw new Error('noncanonical base64url');
  return b;
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
function littleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
}
function canonicalPoint(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  const y = Uint8Array.from(bytes); y[31] = y[31]! & 0x7f;
  const value = littleEndian(y);
  // x=0 has no odd encoding; the sign bit would be an alternate point spelling.
  return value < FIELD && !(bytes[31]! >= 128 && (value === 1n || value === FIELD - 1n));
}
function admittedKey(entry: VerificationKey, currentDay: number): KeyObject {
  uint(entry.firstDay, U32, 'key first day'); uint(entry.lastDay, U32, 'key last day');
  if (typeof entry.revoked !== 'boolean' || entry.firstDay > entry.lastDay ||
      entry.revoked || currentDay < entry.firstDay || currentDay > entry.lastDay) throw new Error('key not admitted');
  if (entry.publicKey.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
  const der = entry.publicKey.export({ format: 'der', type: 'spki' });
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  if (!Buffer.isBuffer(der) || der.length !== 44 || !der.subarray(0, 12).equals(prefix)) throw new Error('bad key encoding');
  const raw = der.subarray(12);
  if (!canonicalPoint(raw) || WEAK_POINTS.has(raw.toString('hex'))) throw new Error('weak/noncanonical key');
  return entry.publicKey;
}
function strictSignature(signature: Uint8Array): void {
  if (signature.length !== 64 || !canonicalPoint(signature.subarray(0, 32)) ||
      WEAK_POINTS.has(Buffer.from(signature.subarray(0, 32)).toString('hex')) ||
      littleEndian(signature.subarray(32)) >= ED_ORDER) throw new Error('noncanonical signature');
}
function checkedContext(t: TrustedContext): void {
  uuid(t.generationHex, 'trusted generation'); uint(t.epoch, U32, 'trusted epoch');
  uint(t.shopLocalDay, U32, 'trusted day'); uint(t.maxBuckets, 0xffff, 'bucket limit');
  uint(t.maxPhysicalQuantity, U32, 'quantity limit');
  if (typeof t.currency !== 'string' || !/^[A-Z]{3}$/.test(t.currency) ||
      CURRENCY_EXPONENT_V1[t.currency] !== t.exponent || typeof t.country !== 'string' ||
      !/^[A-Z]{2}$/.test(t.country)) throw new Error('bad trusted currency/country');
  decimalU64(t.marketId, 'trusted market ID');
  if (typeof t.allowNoMarket !== 'boolean' || !(t.keys instanceof Map)) throw new Error('invalid trusted admission config');
  if (t.marketId === '0' && !t.allowNoMarket) throw new Error('no-market context not admitted');
}
function checkedPhysicalLine(line: PhysicalLine): void {
  positiveU64(line.variantId, 'observed variant ID'); uint(line.quantity, U32, 'observed quantity');
  if (line.quantity === 0 || typeof line.marked !== 'boolean' ||
      typeof line.requiresAuthorization !== 'boolean' || typeof line.hasSellingPlan !== 'boolean') {
    throw new Error('invalid physical line');
  }
}

/** Each adapter supplies independent context and normalized physical lines. */
export function verifyCompleteQuote(cart: PhysicalCart, trusted: TrustedContext): SetDecision {
  checkedContext(trusted);
  if (!Array.isArray(cart.lines)) throw new Error('physical lines unavailable');
  if (cart.envelope === undefined) {
    for (const line of cart.lines) {
      checkedPhysicalLine(line);
      if (line.marked || line.member !== undefined || line.requiresAuthorization) {
        throw new Error('unsigned required/marked line');
      }
    }
    return { accepted: true, bucketCount: 0, totalQuantity: 0, totalMinor: '0' };
  }
  const envelope = carrier(cart.envelope, ENVELOPE_CHARACTERS, HEADER_BYTES + 64);
  const header = decodeHeader(envelope.subarray(0, HEADER_BYTES));
  if (header.count > trusted.maxBuckets || header.totalQuantity > trusted.maxPhysicalQuantity) throw new Error('capacity exceeded');
  if (header.generationHex !== trusted.generationHex || header.epoch !== trusted.epoch ||
      header.currency !== trusted.currency || header.exponent !== trusted.exponent ||
      header.country !== trusted.country || header.marketId !== trusted.marketId ||
      trusted.shopLocalDay > header.validThroughDay || header.validThroughDay - trusted.shopLocalDay > 2) {
    throw new Error('independent context mismatch');
  }
  const records: (Buffer | undefined)[] = Array.from({ length: header.count });
  const members: (Member | undefined)[] = Array.from({ length: header.count });
  let count = 0;
  for (const line of cart.lines) {
    checkedPhysicalLine(line);
    if (line.member === undefined) {
      if (line.marked || line.requiresAuthorization) throw new Error('unsigned required/marked line');
      continue;
    }
    if (!line.marked || line.hasSellingPlan || line.observedSubtotal === undefined) throw new Error('invalid marked line');
    const record = carrier(line.member, 30, MEMBER_BYTES), member = decodeMember(record);
    if (member.index >= header.count || records[member.index] !== undefined) throw new Error('extra/duplicate member index');
    if (member.variantId !== line.variantId || member.quantity !== line.quantity) throw new Error('physical identity/quantity mismatch');
    if (parseMinor(line.observedSubtotal, header.exponent) !== BigInt(member.quantity) * decimalU64(member.unitMinor, 'unit minor')) {
      throw new Error('observed price mismatch');
    }
    records[member.index] = record; members[member.index] = member; count++;
  }
  if (count !== header.count || records.some(x => x === undefined)) throw new Error('missing member');
  checkSet(header, members as Member[]);
  const entry = trusted.keys.get(header.keyId);
  if (!entry) throw new Error('unknown key ID');
  const key = admittedKey(entry, trusted.shopLocalDay), signature = envelope.subarray(HEADER_BYTES);
  strictSignature(signature);
  if (!verify(null, Buffer.concat([DOMAIN, envelope.subarray(0, HEADER_BYTES), ...records as Buffer[]]), key, signature)) {
    throw new Error('invalid whole-quote signature');
  }
  return { accepted: true, bucketCount: count, totalQuantity: header.totalQuantity, totalMinor: header.totalMinor };
}
