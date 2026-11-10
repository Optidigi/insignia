/** Reproducible synthetic cart-line v3 vectors from the production TypeScript issuer. Shared with Rust. */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  DOMAIN_V3,
  EMPTY_SLOT_V3,
  encodeRecordV3,
  HEADER_V3_BYTES,
  type HeaderV3Claims,
  issueLineSetV3,
  LEAF_LABEL_V3,
  type LineRecordV3,
  leafHashV3,
  lineRefV3,
  merkleProofV3,
  merkleRootV3,
  PREFIX_V3_CHARS,
} from '../src/line-v3.ts';
import { type AuthorizationSigner, DOMAIN as DOMAIN_V2 } from '../src/whole-quote.ts';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value');
  return value;
}
const label = 'Insignia cart-line v3 synthetic deterministic fixture only';
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    createHash('sha256').update(label).digest(),
  ]),
  format: 'der',
  type: 'pkcs8',
});
const publicHex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const signer: AuthorizationSigner = {
  signWholeQuote: async (input) => ({
    keyId: 7,
    publicKeyFingerprint: createHash('sha256').update(Buffer.from(publicHex, 'hex')).digest('hex'),
    firstValidDay: 20800,
    lastValidDay: 20802,
    signature: sign(null, input.message, privateKey),
  }),
};
const context = {
  keyId: 7,
  generationHex: '11111111111141118111111111111111',
  epoch: 4,
  currency: 'EUR',
  exponent: 2,
  country: 'DE',
  marketId: '42',
  validThroughDay: 20802,
};
const specs: { name: string; ordinaryLines: number; variants: string[]; units: string[] }[] = [
  { name: 'one_line', ordinaryLines: 0, variants: ['101'], units: ['1999'] },
  { name: 'two_lines', ordinaryLines: 0, variants: ['9007199254740993', '9007199254740994'], units: ['3033', '3034'] },
  // Two designs on one variant are two records with different indices.
  {
    name: 'three_lines_shared_variant',
    ordinaryLines: 3,
    variants: ['401', '401', '402'],
    units: ['2500', '2700', '0'],
  },
  {
    name: 'five_lines',
    ordinaryLines: 0,
    variants: ['501', '502', '503', '504', '505'],
    units: ['100', '200', '300', '400', '9223372036854775807'],
  },
  {
    name: 'seventeen_lines',
    ordinaryLines: 0,
    variants: Array.from({ length: 17 }, (_, i) => String(600 + i)),
    units: Array.from({ length: 17 }, (_, i) => String(1000 + i)),
  },
  {
    name: 'thirty_two_plus_168',
    ordinaryLines: 168,
    variants: Array.from({ length: 32 }, (_, i) => String(200 + i)),
    units: Array.from({ length: 32 }, (_, i) => String(2000 + i)),
  },
];
type VectorCase = {
  name: string;
  ordinaryLines: number;
  header: Awaited<ReturnType<typeof issueLineSetV3>>['header'];
  headerHex: string;
  signatureHex: string;
  records: LineRecordV3[];
  recordHex: string[];
  leafHex: string[];
  proofHex: string[][];
  prefix: string;
  carriers: string[];
  refs: string[];
};
const cases: VectorCase[] = [];
for (const [i, spec] of specs.entries()) {
  const records: LineRecordV3[] = spec.variants.map((variantId, index) => ({
    index,
    variantId,
    unitMinor: must(spec.units[index]),
  }));
  const claims: HeaderV3Claims = {
    ...context,
    quoteHex: `${(i + 1).toString(16).padStart(8, '0')}000040008000000000000001`,
    setHex: `${(i + 1).toString(16).padStart(8, '0')}000040008000000000000002`,
  };
  const issued = await issueLineSetV3(claims, records, 20800, signer);
  const raw = Buffer.from(issued.prefix, 'base64url');
  cases.push({
    name: spec.name,
    ordinaryLines: spec.ordinaryLines,
    header: issued.header,
    headerHex: raw.subarray(0, HEADER_V3_BYTES).toString('hex'),
    signatureHex: raw.subarray(HEADER_V3_BYTES).toString('hex'),
    records,
    recordHex: records.map((r) => encodeRecordV3(r).toString('hex')),
    leafHex: records.map((r) => leafHashV3(r).toString('hex')),
    proofHex: records.map((r) => merkleProofV3(records, r.index).map((p) => p.toString('hex'))),
    prefix: issued.prefix,
    carriers: issued.carriers,
    refs: records.map((r) => lineRefV3(claims.setHex, r.index)),
  });
}

// Negative vectors. `lines` are cart lines (carrier, real variant, quantity, observed unit) that both
// the Rust Function core and the TypeScript set verifier must reject under the case context.
const five = must(cases.find((c) => c.name === 'five_lines'));
const two = must(cases.find((c) => c.name === 'two_lines'));
const seventeen = must(cases.find((c) => c.name === 'seventeen_lines'));
const thirtyTwo = must(cases.find((c) => c.name === 'thirty_two_plus_168'));
const line = (c: VectorCase, index: number, carrier = must(c.carriers[index])) => ({
  carrier,
  variantId: must(c.records[index]).variantId,
  quantity: 1,
  observedUnitMinor: must(c.records[index]).unitMinor,
});
const raw = (carrier: string) => Buffer.from(carrier, 'base64url');
const enc = (bytes: Buffer) => bytes.toString('base64url');
function mutate(carrier: string, offset: number, xor = 1): string {
  const b = raw(carrier);
  b[offset] = must(b[offset]) ^ xor;
  return enc(b);
}
/** Re-sign a structurally altered header with the real key, so only structural rules can reject it. */
function resigned(c: VectorCase, index: number, edit: (header: Buffer) => void, domain = DOMAIN_V3) {
  const b = raw(must(c.carriers[index]));
  const header = b.subarray(0, HEADER_V3_BYTES);
  edit(header);
  sign(null, Buffer.concat([domain, header]), privateKey).copy(b, HEADER_V3_BYTES);
  return enc(b);
}
const tailStart = HEADER_V3_BYTES + 64;
const swappedRecord = raw(must(five.carriers[3]));
encodeRecordV3(must(five.records[2])).copy(swappedRecord, tailStart);
const paddingClaim = raw(must(five.carriers[4]));
paddingClaim[tailStart] = 5; // n=5 has padding slots 5..7.
const otherSet = must(cases.find((c) => c.name === 'three_lines_shared_variant'));
const negatives = [
  {
    name: 'forged_proof_sibling',
    rust: 'Proof',
    lines: [line(five, 3, mutate(must(five.carriers[3]), tailStart + 17))],
  },
  {
    name: 'forged_last_proof_byte',
    rust: 'Proof',
    lines: [line(five, 3, mutate(must(five.carriers[3]), tailStart + 17 + 95))],
  },
  {
    name: 'swapped_record_keeps_other_proof',
    rust: 'Line',
    lines: [{ ...line(five, 3, enc(swappedRecord)), variantId: must(five.records[2]).variantId }],
  },
  {
    name: 'swapped_record_matching_variant',
    rust: 'Proof',
    lines: [
      {
        ...line(five, 3, enc(swappedRecord)),
        variantId: must(five.records[2]).variantId,
        observedUnitMinor: must(five.records[2]).unitMinor,
      },
    ],
  },
  {
    name: 'wrong_index_same_proof',
    rust: 'Proof',
    lines: [line(five, 3, mutate(must(five.carriers[3]), tailStart, 3 ^ 2))],
  },
  { name: 'index_in_padding_slot', rust: 'Line', lines: [line(five, 4, enc(paddingClaim))] },
  { name: 'index_255', rust: 'Line', lines: [line(five, 4, mutate(must(five.carriers[4]), tailStart, 4 ^ 255))] },
  {
    name: 'wrong_unit_in_record',
    rust: 'Proof',
    lines: [{ ...line(five, 1, mutate(must(five.carriers[1]), tailStart + 16)), observedUnitMinor: '201' }],
  },
  {
    name: 'wrong_variant_in_record',
    rust: 'Line',
    lines: [line(five, 1, mutate(must(five.carriers[1]), tailStart + 8))],
  },
  { name: 'tampered_root_unsigned', rust: 'Proof', lines: [line(five, 0, mutate(must(five.carriers[0]), 80))] },
  {
    name: 'resigned_root_of_other_tree',
    rust: 'Proof',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => merkleRootV3(two.records).copy(h, 80)),
      ),
    ],
  },
  { name: 'tampered_header_market', rust: 'Context', lines: [line(five, 0, mutate(must(five.carriers[0]), 75))] },
  { name: 'tampered_header_set', rust: 'Signature', lines: [line(five, 0, mutate(must(five.carriers[0]), 59))] },
  { name: 'tampered_header_quote', rust: 'Signature', lines: [line(five, 0, mutate(must(five.carriers[0]), 43))] },
  { name: 'tampered_header_key_id', rust: 'UnknownKey', lines: [line(five, 0, mutate(must(five.carriers[0]), 7))] },
  {
    name: 'tampered_signature',
    rust: 'Signature',
    lines: [line(five, 0, mutate(must(five.carriers[0]), HEADER_V3_BYTES + 10))],
  },
  {
    name: 'signature_s_high_bit',
    rust: 'Signature',
    lines: [line(five, 0, mutate(must(five.carriers[0]), HEADER_V3_BYTES + 63, 0x80))],
  },
  {
    name: 'v2_domain_signature_on_v3_header',
    rust: 'Signature',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, () => {}, DOMAIN_V2),
      ),
    ],
  },
  {
    name: 'resigned_magic',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => h.write('ISG2', 0, 'ascii')),
      ),
    ],
  },
  {
    name: 'resigned_version',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[4] = 2)),
      ),
    ],
  },
  {
    name: 'resigned_flags',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[5] = 1)),
      ),
    ],
  },
  {
    name: 'resigned_reserved',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[112] = 1)),
      ),
    ],
  },
  {
    name: 'resigned_depth_too_small',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[61] = 2)),
      ),
    ],
  },
  {
    name: 'resigned_depth_too_large',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[61] = 4)),
      ),
    ],
  },
  {
    name: 'resigned_count_zero',
    rust: 'Header',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[60] = 0)),
      ),
    ],
  },
  {
    name: 'resigned_count_33',
    rust: 'Header',
    lines: [
      line(
        seventeen,
        0,
        resigned(seventeen, 0, (h) => (h[60] = 33)),
      ),
    ],
  },
  {
    // Same depth (17..32 all use five proof levels), so only the index bound rejects it.
    name: 'resigned_count_shrunk_below_index',
    rust: 'Line',
    lines: [
      line(
        thirtyTwo,
        31,
        resigned(thirtyTwo, 31, (h) => (h[60] = 17)),
      ),
    ],
  },
  {
    name: 'resigned_lowercase_currency',
    rust: 'UnsupportedCurrency',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => h.write('eur', 62, 'ascii')),
      ),
    ],
  },
  {
    name: 'resigned_wrong_exponent',
    rust: 'UnsupportedCurrency',
    lines: [
      line(
        five,
        0,
        resigned(five, 0, (h) => (h[65] = 3)),
      ),
    ],
  },
  { name: 'truncated_one_char', rust: 'MixedSet', lines: [line(five, 0, must(five.carriers[0]).slice(0, -1))] },
  {
    name: 'truncated_one_hash',
    rust: 'MixedSet',
    lines: [line(five, 0, enc(raw(must(five.carriers[0])).subarray(0, -32)))],
  },
  { name: 'prefix_only', rust: 'MixedSet', lines: [line(five, 0, five.prefix)] },
  { name: 'short_of_prefix', rust: 'Encoding', lines: [line(five, 0, five.prefix.slice(0, 200))] },
  { name: 'extended_one_char', rust: 'MixedSet', lines: [line(five, 0, `${five.carriers[0]}A`)] },
  {
    name: 'extended_one_hash',
    rust: 'MixedSet',
    lines: [line(five, 0, enc(Buffer.concat([raw(must(five.carriers[0])), Buffer.alloc(32)])))],
  },
  { name: 'oversized_carrier', rust: 'MixedSet', lines: [line(five, 0, `${five.carriers[0]}${'A'.repeat(4096)}`)] },
  {
    name: 'noncanonical_tail_trailing_bits',
    rust: 'Encoding',
    // 17 + 32*3 = 113 bytes: 113 % 3 == 2, so the last character carries two unused bits.
    lines: [
      line(
        five,
        0,
        `${must(five.carriers[0]).slice(0, -1)}${String.fromCharCode((must(five.carriers[0]).at(-1)?.charCodeAt(0) ?? 0) + 1)}`,
      ),
    ],
  },
  { name: 'padded_carrier', rust: 'MixedSet', lines: [line(five, 0, `${five.carriers[0]}=`)] },
  {
    name: 'standard_alphabet',
    rust: 'Encoding',
    lines: [
      line(
        two,
        0,
        `${must(two.carriers[0]).slice(0, PREFIX_V3_CHARS)}${must(two.carriers[0])
          .slice(PREFIX_V3_CHARS)
          .replace(/[A-Za-z0-9]/, '+')}`,
      ),
    ],
  },
  { name: 'duplicate_carrier', rust: 'Duplicate', lines: [line(five, 1), line(five, 1)] },
  { name: 'mixed_sets', rust: 'MixedSet', lines: [line(five, 0), line(otherSet, 0)] },
  { name: 'more_lines_than_signed', rust: 'Incomplete', lines: [line(two, 0), line(two, 1), line(two, 1)] },
];

const hashes = {
  domainHex: DOMAIN_V3.toString('hex'),
  leafLabelHex: LEAF_LABEL_V3.toString('hex'),
  emptySlotHex: EMPTY_SLOT_V3.toString('hex'),
};
const vector = {
  version: 'cart-line-v3-vectors-v1',
  provenance: 'Derived synthetic fixture; deterministic key material is constructed only in generator memory',
  context: { ...context, currentDay: 20800, keyFirstDay: 20800, keyLastDay: 20802 },
  publicHex,
  ...hashes,
  cases,
  negatives,
};
const serialized = `${JSON.stringify(vector, null, 2)}\n`;
const target = new URL('cart-line-v3.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== serialized) throw Error('cart-line-v3.json differs from production TypeScript');
} else writeFileSync(target, serialized);
