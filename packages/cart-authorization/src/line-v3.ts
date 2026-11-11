import { createHash, createPublicKey, verify } from 'node:crypto';
import { currencyExponent } from './currency.ts';
import type { AuthorizationSigner } from './whole-quote.ts';

/**
 * Cart-line authorization v3: one Ed25519 signature per issuance over a header that commits to a
 * Merkle root of per-line records. Every customized cart line carries the shared signed prefix
 * (header + signature), its own record and its inclusion proof, so it verifies without any other
 * line. Quantity and totals are deliberately not signed. Exact layout: docs/architecture/CART-LINE-V3.md.
 */
export const DOMAIN_V3 = Buffer.from('Insignia\0CartLineAuthorization\0v3\0', 'ascii');
export const LEAF_LABEL_V3 = Buffer.from('Insignia\0CartLine\0v3\0', 'ascii');
export const LINE_ATTRIBUTE = '_insignia_line_v3';
export const REF_ATTRIBUTE = '_insignia_ref_v3';
export const HEADER_V3_BYTES = 113;
export const SIGNATURE_BYTES = 64;
export const PREFIX_V3_BYTES = HEADER_V3_BYTES + SIGNATURE_BYTES;
/** 177 bytes is a multiple of 3, so the prefix is an exact, padding-free 236-character string. */
export const PREFIX_V3_CHARS = 236;
export const RECORD_V3_BYTES = 17;
export const HASH_BYTES = 32;
export const MAX_LINES_V3 = 32;
export const MAX_DEPTH_V3 = 5;
export const REF_V3_CHARS = 23;
const U32 = 0xffffffff;
const U64 = (1n << 64n) - 1n;

export interface HeaderV3 {
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
  rootHex: string;
}
/** The claims of one signed line: quote-global index, real variant, pre-discount unit price. */
export interface LineRecordV3 {
  index: number;
  variantId: string;
  unitMinor: string;
}
export interface LineCarrierV3 {
  /** The first 236 characters, identical on every line of one issued set. */
  prefix: string;
  header: HeaderV3;
  signature: Buffer;
  record: LineRecordV3;
  proof: Buffer[];
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
function hexBytes(text: string, bytes: number, name: string): Buffer {
  if (typeof text !== 'string' || !new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(text))
    throw new Error(`${name}: invalid bytes`);
  return Buffer.from(text, 'hex');
}
/** Proof depth is fixed by the signed line count: ceil(log2 n), 0 for one line. */
export function depthForCount(count: number): number {
  unsigned(count, MAX_LINES_V3, 'count');
  if (count < 1) throw new Error('count: at least one line');
  let depth = 0;
  while (1 << depth < count) depth++;
  return depth;
}
export function carrierBytes(depth: number): number {
  unsigned(depth, MAX_DEPTH_V3, 'depth');
  return PREFIX_V3_BYTES + RECORD_V3_BYTES + HASH_BYTES * depth;
}
export function carrierChars(depth: number): number {
  return Math.ceil((carrierBytes(depth) * 4) / 3);
}
function checkHeader(h: HeaderV3): void {
  unsigned(h.keyId, 0xffff, 'key ID');
  hexBytes(h.generationHex, 16, 'generation');
  unsigned(h.epoch, U32, 'epoch');
  hexBytes(h.quoteHex, 16, 'quote');
  hexBytes(h.setHex, 16, 'set');
  depthForCount(h.count);
  if (!/^[A-Z]{3}$/.test(h.currency) || currencyExponent(h.currency) !== h.exponent)
    throw new Error('unsupported currency/exponent');
  if (!/^[A-Z]{2}$/.test(h.country)) throw new Error('invalid country');
  decimalU64(h.marketId, 'market');
  unsigned(h.validThroughDay, U32, 'day');
  hexBytes(h.rootHex, HASH_BYTES, 'root');
}
function checkRecord(r: LineRecordV3, count?: number): void {
  unsigned(r.index, 0xff, 'index');
  if (count !== undefined && r.index >= count) throw new Error('index outside signed line count');
  if (decimalU64(r.variantId, 'variant') === 0n) throw new Error('zero variant');
  decimalU64(r.unitMinor, 'unit minor');
}
export function encodeHeaderV3(h: HeaderV3): Buffer {
  checkHeader(h);
  const b = Buffer.alloc(HEADER_V3_BYTES);
  b.write('ISG3', 0, 'ascii');
  b[4] = 3;
  b[5] = 0;
  b.writeUInt16BE(h.keyId, 6);
  hexBytes(h.generationHex, 16, 'generation').copy(b, 8);
  b.writeUInt32BE(h.epoch, 24);
  hexBytes(h.quoteHex, 16, 'quote').copy(b, 28);
  hexBytes(h.setHex, 16, 'set').copy(b, 44);
  b[60] = h.count;
  b[61] = depthForCount(h.count);
  b.write(h.currency, 62, 3, 'ascii');
  b[65] = h.exponent;
  b.write(h.country, 66, 2, 'ascii');
  b.writeBigUInt64BE(decimalU64(h.marketId, 'market'), 68);
  b.writeUInt32BE(h.validThroughDay, 76);
  hexBytes(h.rootHex, HASH_BYTES, 'root').copy(b, 80);
  b[112] = 0;
  return b;
}
export function decodeHeaderV3(raw: Uint8Array): HeaderV3 {
  const b = Buffer.from(raw);
  if (
    b.length !== HEADER_V3_BYTES ||
    !b.subarray(0, 4).equals(Buffer.from('ISG3')) ||
    b[4] !== 3 ||
    b[5] !== 0 ||
    b[112] !== 0
  )
    throw new Error('invalid v3 header');
  const count = b.readUInt8(60);
  if (count < 1 || count > MAX_LINES_V3 || b[61] !== depthForCount(count)) throw new Error('invalid v3 line count');
  if (![...b.subarray(62, 65), ...b.subarray(66, 68)].every((c) => c >= 65 && c <= 90))
    throw new Error('invalid uppercase header');
  const h: HeaderV3 = {
    keyId: b.readUInt16BE(6),
    generationHex: b.subarray(8, 24).toString('hex'),
    epoch: b.readUInt32BE(24),
    quoteHex: b.subarray(28, 44).toString('hex'),
    setHex: b.subarray(44, 60).toString('hex'),
    count,
    currency: b.toString('ascii', 62, 65),
    exponent: b.readUInt8(65),
    country: b.toString('ascii', 66, 68),
    marketId: b.readBigUInt64BE(68).toString(),
    validThroughDay: b.readUInt32BE(76),
    rootHex: b.subarray(80, 112).toString('hex'),
  };
  checkHeader(h);
  return h;
}
export function encodeRecordV3(r: LineRecordV3): Buffer {
  checkRecord(r);
  const b = Buffer.alloc(RECORD_V3_BYTES);
  b[0] = r.index;
  b.writeBigUInt64BE(decimalU64(r.variantId, 'variant'), 1);
  b.writeBigUInt64BE(decimalU64(r.unitMinor, 'unit minor'), 9);
  return b;
}
export function decodeRecordV3(raw: Uint8Array): LineRecordV3 {
  const b = Buffer.from(raw);
  if (b.length !== RECORD_V3_BYTES) throw new Error('invalid v3 record length');
  const r = {
    index: b.readUInt8(0),
    variantId: b.readBigUInt64BE(1).toString(),
    unitMinor: b.readBigUInt64BE(9).toString(),
  };
  checkRecord(r);
  return r;
}
const sha512_256 = (...parts: Uint8Array[]) => {
  const hash = createHash('sha512-256');
  for (const part of parts) hash.update(part);
  return hash.digest();
};
/** Domain-separated leaf: 0x00 || label || 17-byte record. */
export function leafHashV3(record: LineRecordV3): Buffer {
  return sha512_256(Buffer.of(0), LEAF_LABEL_V3, encodeRecordV3(record));
}
/** Domain-separated inner node: 0x01 || left || right. */
export function nodeHashV3(left: Uint8Array, right: Uint8Array): Buffer {
  if (left.length !== HASH_BYTES || right.length !== HASH_BYTES) throw new Error('invalid node child');
  return sha512_256(Buffer.of(1), left, right);
}
/** Padding slot beyond the signed count: 0x02 || label. It is never a claimable leaf (index < count). */
export const EMPTY_SLOT_V3 = sha512_256(Buffer.of(2), LEAF_LABEL_V3);

function completeRecords(records: readonly LineRecordV3[]): void {
  depthForCount(records.length);
  for (const [i, r] of records.entries()) {
    checkRecord(r, records.length);
    if (r.index !== i) throw new Error('records must be complete and index-ordered');
  }
}
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('index outside tree');
  return value;
}
function levels(records: readonly LineRecordV3[]): Buffer[][] {
  completeRecords(records);
  const depth = depthForCount(records.length);
  let level = Array.from({ length: 1 << depth }, (_, i) => {
    const record = records[i];
    return record ? leafHashV3(record) : EMPTY_SLOT_V3;
  });
  const result = [level];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(nodeHashV3(at(level, i), at(level, i + 1)));
    result.push(next);
    level = next;
  }
  return result;
}
export function merkleRootV3(records: readonly LineRecordV3[]): Buffer {
  const all = levels(records);
  return at(at(all, all.length - 1), 0);
}
/** Sibling hashes from leaf to root; bit k of the index selects the side at level k. */
export function merkleProofV3(records: readonly LineRecordV3[], index: number): Buffer[] {
  const all = levels(records);
  unsigned(index, records.length - 1, 'index');
  return all.slice(0, -1).map((level, k) => at(level, (index >> k) ^ 1));
}
/** Recompute the root from one record and its proof. Requires the proof length the count fixes. */
export function proofRootV3(record: LineRecordV3, proof: readonly Uint8Array[], count: number): Buffer {
  const depth = depthForCount(count);
  checkRecord(record, count);
  if (proof.length !== depth) throw new Error('proof length does not match signed line count');
  let node = leafHashV3(record);
  for (const [k, sibling] of proof.entries())
    node = (record.index >> k) & 1 ? nodeHashV3(sibling, node) : nodeHashV3(node, sibling);
  return node;
}
export function lineV3SignBytes(h: HeaderV3): Buffer {
  return Buffer.concat([DOMAIN_V3, encodeHeaderV3(h)]);
}
function canonical(text: unknown, bytes: number): Buffer {
  const chars = Math.ceil((bytes * 4) / 3);
  if (typeof text !== 'string' || text.length !== chars || !/^[A-Za-z0-9_-]+$/.test(text))
    throw new Error('invalid carrier');
  const raw = Buffer.from(text, 'base64url');
  if (raw.length !== bytes || raw.toString('base64url') !== text) throw new Error('noncanonical carrier');
  return raw;
}
/** Decode the shared 236-character prefix: header + signature. */
export function decodePrefixV3(text: unknown): { header: HeaderV3; signature: Buffer } {
  const raw = canonical(text, PREFIX_V3_BYTES);
  return { header: decodeHeaderV3(raw.subarray(0, HEADER_V3_BYTES)), signature: raw.subarray(HEADER_V3_BYTES) };
}
/**
 * Strict canonical structure decode of one line carrier. It checks the exact length implied by the
 * signed count, the record index against that count and the proof length; it does not verify the
 * signature or the Merkle inclusion (see verifyLineCarrierV3).
 */
export function decodeLineCarrierV3(text: unknown): LineCarrierV3 {
  if (typeof text !== 'string' || text.length < PREFIX_V3_CHARS) throw new Error('invalid carrier');
  const prefix = text.slice(0, PREFIX_V3_CHARS);
  const { header, signature } = decodePrefixV3(prefix);
  const depth = depthForCount(header.count);
  const tail = canonical(text.slice(PREFIX_V3_CHARS), RECORD_V3_BYTES + HASH_BYTES * depth);
  const record = decodeRecordV3(tail.subarray(0, RECORD_V3_BYTES));
  if (record.index >= header.count) throw new Error('index outside signed line count');
  const proof = Array.from({ length: depth }, (_, k) =>
    tail.subarray(RECORD_V3_BYTES + HASH_BYTES * k, RECORD_V3_BYTES + HASH_BYTES * (k + 1)),
  );
  return { prefix, header, signature, record, proof };
}
/** Inclusion check only: the record and proof hash to the root the header signs. */
export function lineCarrierIncludedV3(carrier: LineCarrierV3): boolean {
  return proofRootV3(carrier.record, carrier.proof, carrier.header.count).equals(
    Buffer.from(carrier.header.rootHex, 'hex'),
  );
}
export function encodeLineCarrierV3(prefix: Uint8Array, record: LineRecordV3, proof: readonly Uint8Array[]): string {
  if (prefix.length !== PREFIX_V3_BYTES) throw new Error('invalid prefix');
  const header = decodeHeaderV3(prefix.subarray(0, HEADER_V3_BYTES));
  checkRecord(record, header.count);
  if (proof.length !== depthForCount(header.count) || proof.some((p) => p.length !== HASH_BYTES))
    throw new Error('invalid proof');
  return Buffer.concat([prefix, encodeRecordV3(record), ...proof]).toString('base64url');
}
/** Short child reference written by Transform: base64url(set UUID bytes || index). */
export function lineRefV3(setHex: string, index: number): string {
  return Buffer.concat([hexBytes(setHex, 16, 'set'), Buffer.of(unsigned(index, 0xff, 'index'))]).toString('base64url');
}
export type HeaderV3Claims = Omit<HeaderV3, 'rootHex' | 'count'>;
export async function issueLineSetV3(
  claims: HeaderV3Claims,
  records: readonly LineRecordV3[],
  issuanceDay: number,
  signer: AuthorizationSigner,
): Promise<{
  prefix: string;
  header: HeaderV3;
  carriers: string[];
  keyId: number;
  publicKeyFingerprint: string;
  firstValidDay: number;
  lastValidDay: number;
}> {
  unsigned(issuanceDay, U32 - 2, 'issuance day');
  if (claims.validThroughDay !== issuanceDay + 2) throw new Error('expiry must be D+2');
  const header: HeaderV3 = { ...claims, count: records.length, rootHex: merkleRootV3(records).toString('hex') };
  const message = lineV3SignBytes(header);
  const result = await signer.signWholeQuote({
    message,
    keyId: header.keyId,
    issuanceDay,
    validThroughDay: header.validThroughDay,
    generationHex: header.generationHex,
    epoch: header.epoch,
    quoteHex: header.quoteHex,
    setHex: header.setHex,
  });
  if (
    result.keyId !== header.keyId ||
    !result.publicKeyFingerprint ||
    !Number.isSafeInteger(result.firstValidDay) ||
    !Number.isSafeInteger(result.lastValidDay) ||
    result.firstValidDay < 0 ||
    result.lastValidDay > U32 ||
    result.firstValidDay > result.lastValidDay ||
    result.firstValidDay > issuanceDay ||
    result.lastValidDay < header.validThroughDay
  )
    throw new Error('signer key validity does not cover D..D+2');
  if (!(result.signature instanceof Uint8Array) || result.signature.length !== SIGNATURE_BYTES)
    throw new Error('invalid Ed25519 signature');
  const prefix = Buffer.concat([encodeHeaderV3(header), Buffer.from(result.signature)]);
  return {
    prefix: prefix.toString('base64url'),
    header,
    carriers: records.map((record) => encodeLineCarrierV3(prefix, record, merkleProofV3(records, record.index))),
    keyId: result.keyId,
    publicKeyFingerprint: result.publicKeyFingerprint,
    firstValidDay: result.firstValidDay,
    lastValidDay: result.lastValidDay,
  };
}

/**
 * Lean v3 issuance signs a unit price that holds at any quantity. Refuse economics whose price
 * depends on quantity: setup allocation, quantity-selected components, split buckets or non-linear totals.
 */
export function linearLineRecordsV3(economics: {
  groups: readonly {
    setupMinor: string;
    setupComponents: readonly unknown[];
    unitComponents: readonly { selectedMinQuantity: number | null }[];
  }[];
  lines: readonly {
    lineIndex: number;
    variantId: string;
    quantity: number;
    unitPriceMinor: string;
    setupPerUnitMinor: string;
    lineTotalMinor: string;
    canonicalIdentitySha256?: string;
    productId?: string;
  }[];
}): LineRecordV3[] {
  if (
    economics.groups.some(
      (g) =>
        g.setupMinor !== '0' ||
        g.setupComponents.length !== 0 ||
        g.unitComponents.some((c) => c.selectedMinQuantity !== null),
    )
  )
    throw new Error('v3 requires linear per-unit economics');
  const buckets = new Set<string>();
  return economics.lines.map((line, index) => {
    if (line.lineIndex !== index) throw new Error('lines are not quote-global ordered');
    const key = `${line.canonicalIdentitySha256 ?? ''}\0${line.productId ?? ''}\0${line.variantId}`;
    if (
      buckets.has(key) ||
      line.setupPerUnitMinor !== '0' ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      decimalU64(line.unitPriceMinor, 'unit minor') * BigInt(line.quantity) !==
        decimalU64(line.lineTotalMinor, 'line total')
    )
      throw new Error('v3 requires linear per-unit economics');
    buckets.add(key);
    return { index, variantId: line.variantId, unitMinor: line.unitPriceMinor };
  });
}

/**
 * Verify carriers that claim one signed set (e.g. the lines of one order): one shared prefix, canonical
 * structure, unique in-range indices, Merkle inclusion and one Ed25519 signature under the given raw
 * public key. Context, day window and key admission belong to the caller.
 */
export function verifyLineSetV3(
  carriers: readonly string[],
  publicKey: Uint8Array,
): { header: HeaderV3; signature: Buffer; records: LineRecordV3[] } {
  if (carriers.length === 0) throw new Error('no line carriers');
  const decoded = carriers.map(decodeLineCarrierV3);
  const { header, signature, prefix } = at(decoded, 0);
  if (carriers.length > header.count) throw new Error('more lines than the signed count');
  const seen = new Set<number>();
  for (const carrier of decoded) {
    if (carrier.prefix !== prefix) throw new Error('mixed authorization sets');
    if (seen.has(carrier.record.index)) throw new Error('duplicate line index');
    seen.add(carrier.record.index);
    if (!lineCarrierIncludedV3(carrier)) throw new Error('line is not included in the signed root');
  }
  if (publicKey.length !== 32) throw new Error('invalid Ed25519 public key');
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey)]),
    format: 'der',
    type: 'spki',
  });
  if (!verify(null, lineV3SignBytes(header), key, signature)) throw new Error('invalid authorization signature');
  return { header, signature, records: decoded.map((c) => c.record) };
}
