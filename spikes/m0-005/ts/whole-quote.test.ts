import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { allocateGroups, formatMinor } from '../../m0-004/ts/allocation.ts';
import { privateKeyFromSeed, publicKeyFromHex } from '../../m0-004/ts/authorization.ts';
import {
  DOMAIN, HEADER_BYTES, MEMBER_BYTES, ENVELOPE_CHARACTERS,
  encodeHeader, decodeHeader, encodeMember, decodeMember, issueWholeQuote, issueAllocatedQuote,
  verifyCompleteQuote, type Header, type Member, type PhysicalLine, type TrustedContext,
} from './whole-quote.ts';

// RFC 8032 test key 1; public synthetic data only.
const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const publicHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const signingKey = privateKeyFromSeed(seed);
const header: Header = {
  keyId: 7, generationHex: '00'.repeat(16), epoch: 2,
  quoteHex: '11'.repeat(16), setHex: '22'.repeat(16), count: 2,
  currency: 'EUR', exponent: 2, country: 'DE', marketId: '42',
  validThroughDay: 20802, totalQuantity: 3, totalMinor: '9100',
};
const members: Member[] = [
  { index: 0, variantId: '9007199254740993', quantity: 2, unitMinor: '3033' },
  { index: 1, variantId: '9007199254740993', quantity: 1, unitMinor: '3034' },
];
const context: TrustedContext = {
  generationHex: header.generationHex, epoch: header.epoch, currency: 'EUR', exponent: 2,
  country: 'DE', marketId: '42', allowNoMarket: false, shopLocalDay: 20800,
  maxBuckets: 64, maxPhysicalQuantity: 10_000,
  keys: new Map([[7, { publicKey: publicKeyFromHex(publicHex), revoked: false,
    firstDay: 20700, lastDay: 20900 }]]),
};
const signed = issueWholeQuote(header, members, signingKey, 20800);
const line = (index: number, patch: Partial<PhysicalLine> = {}): PhysicalLine => ({
  variantId: members[index]!.variantId, quantity: members[index]!.quantity,
  observedSubtotal: index === 0 ? '60.66' : '30.34',
  member: signed.members[index], marked: true, requiresAuthorization: true,
  hasSellingPlan: false, ...patch,
});
const complete = () => [line(0), line(1)];
const verify = (lines: PhysicalLine[], envelope: string | null = signed.envelope,
  trusted: TrustedContext = context) => verifyCompleteQuote({ envelope: envelope ?? undefined, lines }, trusted);
const mutateEnvelope = (at: number, value: number): string => {
  const bytes = Buffer.from(signed.envelope, 'base64url');
  bytes[at] = value;
  return bytes.toString('base64url');
};

test('v2 canonical literal bytes and complete signed acceptance', () => {
  const headerHex = [
    '49534732', '02', '00', '0007', '00'.repeat(16), '00000002',
    '11'.repeat(16), '22'.repeat(16), '0002', '455552', '02', '4445',
    '000000000000002a', '00005142', '00000003', '000000000000238c',
  ].join('');
  assert.equal(encodeHeader(header).toString('hex'), headerHex);
  assert.equal(encodeHeader(header).length, HEADER_BYTES);
  assert.equal(encodeMember(members[0]!).toString('hex'), '00000020000000000001000000020000000000000bd9');
  assert.equal(encodeMember(members[1]!).toString('hex'), '00010020000000000001000000010000000000000bda');
  assert.equal(encodeMember(members[0]!).length, MEMBER_BYTES);
  assert.equal(DOMAIN.toString('hex'), Buffer.from('Insignia\0WholeQuoteAuthorization\0v2\0').toString('hex'));
  assert.equal(signed.envelope.length, ENVELOPE_CHARACTERS);
  // Independent Python cryptography Ed25519 over literal header/records.
  assert.equal(Buffer.from(signed.envelope, 'base64url').subarray(HEADER_BYTES).toString('hex'),
    'ff24c3345d596c7cee485002b348c0e20ed28608fa9a130570934a3d94af6eabbbd2715716cd6e63032b6ad2b3df22008ab897244a8bc0575ed353fc8adc6d02');
  assert.equal(signed.members[0]!.length, 30);
  assert.deepEqual(decodeHeader(Buffer.from(headerHex, 'hex')), header);
  assert.deepEqual(decodeMember(encodeMember(members[0]!)), members[0]);
  assert.deepEqual(verify(complete()), { accepted: true, bucketCount: 2, totalQuantity: 3, totalMinor: '9100' });
});

test('complete cart is independent of enumeration and permits ordinary optional lines', () => {
  const ordinary: PhysicalLine = { variantId: '9', quantity: 1, marked: false,
    requiresAuthorization: false, hasSellingPlan: true };
  assert.deepEqual(verify([ordinary, line(1), line(0)]), verify(complete()));
  assert.deepEqual(verify([ordinary], null), { accepted: true, bucketCount: 0, totalQuantity: 0, totalMinor: '0' });
});

test('issuer rejects noncanonical records, broken totals, and improper expiry', () => {
  assert.throws(() => issueWholeQuote(header, [...members].reverse(), signingKey, 20800));
  assert.throws(() => issueWholeQuote(header, [members[0]!, members[0]!], signingKey, 20800));
  assert.throws(() => issueWholeQuote({ ...header, totalMinor: '9101' }, members, signingKey, 20800));
  assert.throws(() => issueWholeQuote({ ...header, validThroughDay: 20803 }, members, signingKey, 20800));
  assert.throws(() => encodeMember({ ...members[0]!, variantId: '01' }));
});

test('every marked physical member is bound to the full message and observed economics', () => {
  for (const lines of [
    [line(0)], [line(0), line(0)],
    [line(0), line(1, { variantId: '9' })],
    [line(0), line(1, { quantity: 2 })],
    [line(0), line(1, { observedSubtotal: '30.35' })],
    [line(0), line(1, { observedSubtotal: '030.34' })],
    [line(0), line(1, { member: signed.members[0] })],
    [line(0), line(1, { member: undefined })],
    [line(0), line(1, { hasSellingPlan: true })],
  ]) assert.throws(() => verify(lines));
  assert.throws(() => verify(complete(), null));
  assert.throws(() => verify([], signed.envelope));
  assert.throws(() => verify([{ ...line(0), marked: false }, line(1)]));
  assert.throws(() => verify([{ ...line(0), member: undefined }, line(1)]));
});

test('independent context and key admission fail closed', () => {
  for (const patch of [
    { generationHex: 'ff'.repeat(16) }, { epoch: 3 }, { currency: 'USD' },
    { exponent: 0 }, { country: 'FR' }, { marketId: '43' },
    { shopLocalDay: 20799 }, { shopLocalDay: 20803 },
    { maxBuckets: 1 }, { maxPhysicalQuantity: 2 }, { keys: new Map() },
  ]) assert.throws(() => verify(complete(), signed.envelope, { ...context, ...patch }));
  assert.throws(() => verify(complete(), signed.envelope, {
    ...context, keys: new Map([[7, { publicKey: publicKeyFromHex(publicHex), revoked: true,
      firstDay: 20700, lastDay: 20900 }]]),
  }));
  for (const day of [20800, 20801, 20802]) assert.equal(verify(complete(), signed.envelope,
    { ...context, shopLocalDay: day }).accepted, true);
  assert.throws(() => verify([{ ...line(0), requiresAuthorization: true, marked: false,
    member: undefined }], null));
});

test('rejects malformed carriers and fifteen raw high-bit header mutations', () => {
  for (const at of [62, 63, 64, 65, 66]) {
    for (const value of [0x80, 0xc0, 0xff]) assert.throws(() => decodeHeader(Buffer.from(mutateEnvelope(at, value), 'base64url').subarray(0, HEADER_BYTES)));
  }
  for (const at of [0, 4, 5]) assert.throws(() => verify(complete(), mutateEnvelope(at, 0xff)));
  assert.throws(() => verify(complete(), `${signed.envelope}=`));
  assert.throws(() => verify(complete(), `${signed.envelope}A`));
  assert.throws(() => verify(complete(), `${signed.envelope.slice(0, -1)}*`));
  const badSignature = Buffer.from(signed.envelope, 'base64url');
  badSignature[HEADER_BYTES] = badSignature[HEADER_BYTES]! ^ 1;
  assert.throws(() => verify(complete(), badSignature.toString('base64url')));
  assert.throws(() => verify([line(0, { member: `${signed.members[0]}=` }), line(1)]));
});

test('distinct signed equivalent statements accept; mixed quote, set and member data reject', () => {
  const another = issueWholeQuote({ ...header, setHex: '33'.repeat(16) }, members, signingKey, 20800);
  assert.deepEqual(verify(complete(), another.envelope), verify(complete()));
  const changed = issueWholeQuote({ ...header, quoteHex: '44'.repeat(16) }, members, signingKey, 20800);
  assert.deepEqual(verify(complete(), changed.envelope), verify(complete()));
  const mixedEnvelope = Buffer.concat([
    Buffer.from(changed.envelope, 'base64url').subarray(0, HEADER_BYTES),
    Buffer.from(signed.envelope, 'base64url').subarray(HEADER_BYTES),
  ]).toString('base64url');
  assert.throws(() => verify(complete(), mixedEnvelope));
  const altered = issueWholeQuote({ ...header, totalMinor: '9101' },
    [members[0]!, { ...members[1]!, unitMinor: '3035' }], signingKey, 20800);
  assert.throws(() => verify(complete(), altered.envelope));
  const wrongLast = Buffer.from(signed.members[1]!, 'base64url');
  wrongLast[21] = wrongLast[21]! ^ 1;
  assert.throws(() => verify([line(0), line(1, { member: wrongLast.toString('base64url') })]));
});

test('existing M0-004 allocator conserves the EUR 91 quote', () => {
  const allocation = allocateGroups([{ groupId: 'design', setupMinor: '100', variants: [
    { variantId: members[0]!.variantId, quantity: 3, acceptedBaseUnitMinor: '3000' },
  ] }]);
  assert.equal(allocation.totalMinor, '9100');
  assert.deepEqual(allocation.buckets.map(b => [b.quantity, formatMinor(BigInt(b.unitMinor), 2)]),
    [[1, '30.34'], [2, '30.33']]);
  const issued = issueAllocatedQuote([{ groupId: 'design', setupMinor: '100', variants: [
    { variantId: members[0]!.variantId, quantity: 3, acceptedBaseUnitMinor: '3000' },
  ] }], { keyId: header.keyId, generationHex: header.generationHex, epoch: header.epoch,
    quoteHex: header.quoteHex, setHex: header.setHex, currency: header.currency,
    exponent: header.exponent, country: header.country, marketId: header.marketId,
    validThroughDay: header.validThroughDay }, signingKey, 20800);
  const lines = issued.members.map((m, i): PhysicalLine => ({
    variantId: m.variantId, quantity: m.quantity,
    observedSubtotal: formatMinor(BigInt(m.quantity) * BigInt(m.unitMinor), 2),
    member: issued.carriers[i], marked: true, requiresAuthorization: true, hasSellingPlan: false,
  }));
  assert.equal(verifyCompleteQuote({ envelope: issued.envelope, lines }, context).totalMinor, '9100');
});

test('10,000 units in five allocation buckets need no per-unit records', () => {
  const groups = [0, 1, 2, 3, 4].map(i => ({ groupId: `group${i}`, setupMinor: '0', variants: [
    { variantId: String(100 + i), quantity: 2000, acceptedBaseUnitMinor: '100' },
  ] }));
  const issued = issueAllocatedQuote(groups, { keyId: header.keyId,
    generationHex: header.generationHex, epoch: header.epoch, quoteHex: header.quoteHex,
    setHex: header.setHex, currency: header.currency, exponent: header.exponent,
    country: header.country, marketId: header.marketId, validThroughDay: header.validThroughDay },
  signingKey, 20800);
  assert.equal(issued.members.length, 5);
  assert.equal(issued.header.totalQuantity, 10_000);
  assert.equal(issued.header.totalMinor, '1000000');
  const lines = issued.members.map((m, i): PhysicalLine => ({ variantId: m.variantId,
    quantity: m.quantity, observedSubtotal: '2000.00', member: issued.carriers[i],
    marked: true, requiresAuthorization: true, hasSellingPlan: false }));
  assert.equal(verifyCompleteQuote({ envelope: issued.envelope, lines }, context).totalQuantity, 10_000);
});

test('old per-line tokens, noncanonical tail bits and noncanonical Ed25519 S reject', () => {
  const old = Buffer.from(signed.envelope, 'base64url');
  old.write('ISG1', 0, 'ascii'); old[4] = 1;
  assert.throws(() => verify(complete(), old.toString('base64url')));
  // 156 bytes encode to 208 characters; 22 bytes encode to 30 with four unused low bits.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const end = signed.members[0]!.at(-1)!;
  const alteredTail = alphabet[(alphabet.indexOf(end) & ~15) | ((alphabet.indexOf(end) + 1) & 15)]!;
  assert.throws(() => verify([line(0, { member: signed.members[0]!.slice(0, -1) + alteredTail }), line(1)]));
  const signature = Buffer.from(signed.envelope, 'base64url');
  const order = Buffer.from('edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010', 'hex');
  let carry = 0;
  for (let i = 0; i < 32; i++) {
    const sum = signature[HEADER_BYTES + 32 + i]! + order[i]! + carry;
    signature[HEADER_BYTES + 32 + i] = sum & 255; carry = sum >> 8;
  }
  assert.equal(carry, 0);
  assert.throws(() => verify(complete(), signature.toString('base64url')));
});

test('rejects weak, expired, and not-yet-admitted verification keys', () => {
  for (const raw of ['00'.repeat(32), `01${'00'.repeat(31)}`,
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05']) {
    assert.equal(raw.length, 64);
    const keys = new Map([[7, { publicKey: publicKeyFromHex(raw), revoked: false,
      firstDay: 20700, lastDay: 20900 }]]);
    assert.throws(() => verify(complete(), signed.envelope, { ...context, keys }), /weak\/noncanonical key/);
  }
  for (const window of [{ firstDay: 20801, lastDay: 20900 }, { firstDay: 20700, lastDay: 20799 }]) {
    const keys = new Map([[7, { publicKey: publicKeyFromHex(publicHex), revoked: false, ...window }]]);
    assert.throws(() => verify(complete(), signed.envelope, { ...context, keys }));
  }
});

test('day-zero and u32-max issuance retain inclusive E-2..E validity', () => {
  const one: Member[] = [{ index: 0, variantId: '5', quantity: 1, unitMinor: '100' }];
  const h = { ...header, count: 1, totalQuantity: 1, totalMinor: '100' };
  for (const [issuanceDay, expiry] of [[0, 2], [0xfffffffd, 0xffffffff]]) {
    const offer = issueWholeQuote({ ...h, validThroughDay: expiry! }, one, signingKey, issuanceDay!);
    const physical: PhysicalLine[] = [{ variantId: '5', quantity: 1, observedSubtotal: '1.00',
      member: offer.members[0], marked: true, requiresAuthorization: true, hasSellingPlan: false }];
    for (const day of [issuanceDay!, issuanceDay! + 1, expiry!]) {
      const keys = new Map([[7, { publicKey: publicKeyFromHex(publicHex), revoked: false,
        firstDay: 0, lastDay: U32_MAX_FOR_TEST }]]);
      assert.equal(verifyCompleteQuote({ envelope: offer.envelope, lines: physical },
        { ...context, shopLocalDay: day, keys }).accepted, true);
    }
    if (issuanceDay! > 0) assert.throws(() => verifyCompleteQuote({ envelope: offer.envelope, lines: physical },
      { ...context, shopLocalDay: issuanceDay! - 1 }));
  }
});

const U32_MAX_FOR_TEST = 0xffffffff;

test('shared Python, TypeScript and Rust golden carrier bytes agree', () => {
  const vector = JSON.parse(readFileSync(new URL('../fixtures/vectors.json', import.meta.url), 'utf8'));
  const issued = issueWholeQuote(vector.expected as Header,
    vector.expected.members as Member[], signingKey, 20800);
  assert.equal(issued.envelope, vector.envelope);
  assert.deepEqual(issued.members, vector.memberTokens);
  assert.equal(encodeHeader(vector.expected as Header).toString('hex'), vector.headerHex);
});

test('all fifteen independently signed high-bit magic variants reject at header stage', () => {
  for (let mask = 1; mask < 16; mask++) {
    const raw = Buffer.from(signed.envelope, 'base64url');
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) raw[i] = raw[i]! | 0x80;
    const reSigned = sign(null, Buffer.concat([
      DOMAIN, raw.subarray(0, HEADER_BYTES), ...signed.members.map(m => Buffer.from(m, 'base64url')),
    ]), signingKey);
    reSigned.copy(raw, HEADER_BYTES);
    assert.throws(() => verify(complete(), raw.toString('base64url')), /header/);
  }
});

test('large but bounded totals and removed 500-unit tier reject', () => {
  const tierMembers: Member[] = [
    { index: 0, variantId: '10', quantity: 250, unitMinor: '2314' },
    { index: 1, variantId: '20', quantity: 250, unitMinor: '3520' },
  ];
  const tier = issueWholeQuote({ ...header, totalQuantity: 500, totalMinor: '1458500' }, tierMembers, signingKey, 20800);
  const physical: PhysicalLine[] = tierMembers.map((m, i) => ({ variantId: m.variantId, quantity: m.quantity,
    observedSubtotal: i === 0 ? '5785.00' : '8800.00', member: tier.members[i],
    marked: true, requiresAuthorization: true, hasSellingPlan: false }));
  assert.equal(verifyCompleteQuote({ envelope: tier.envelope, lines: physical }, context).totalQuantity, 500);
  assert.throws(() => verifyCompleteQuote({ envelope: tier.envelope, lines: physical.slice(0, 1) }, context));
  assert.throws(() => verifyCompleteQuote({ envelope: tier.envelope, lines: [{ ...physical[0]!, quantity: 10 }, physical[1]!] }, context));
  assert.throws(() => issueWholeQuote({ ...header, count: 1, totalQuantity: 2,
    totalMinor: '18446744073709551615' }, [{ index: 0, variantId: '1', quantity: 2,
    unitMinor: '18446744073709551615' }], signingKey, 20800));
  assert.throws(() => encodeMember({ ...members[0]!, quantity: 0x100000000 }));
});

test('10, 32 and 64 complete buckets coexist with ordinary products; capacity is explicit', () => {
  const ordinary: PhysicalLine = { variantId: '999', quantity: 3, marked: false,
    requiresAuthorization: false, hasSellingPlan: false };
  for (const count of [10, 32, 64]) {
    const records: Member[] = Array.from({ length: count }, (_, index) => ({
      index, variantId: String(index + 1), quantity: 1, unitMinor: '100',
    }));
    const offer = issueWholeQuote({ ...header, count, totalQuantity: count,
      totalMinor: String(count * 100) }, records, signingKey, 20800);
    const lines: PhysicalLine[] = records.map((record, index) => ({ variantId: record.variantId,
      quantity: 1, observedSubtotal: '1.00', member: offer.members[index],
      marked: true, requiresAuthorization: true, hasSellingPlan: false }));
    assert.equal(verifyCompleteQuote({ envelope: offer.envelope, lines: [ordinary, ...lines] }, context).bucketCount, count);
    assert.throws(() => verifyCompleteQuote({ envelope: offer.envelope, lines },
      { ...context, maxBuckets: count - 1 }));
    assert.throws(() => verifyCompleteQuote({ envelope: offer.envelope, lines: [ordinary, ...lines.slice(1)] }, context));
  }
});

test('known required unsigned product denies, while absent required policy is a negative capability', () => {
  const plain: PhysicalLine = { variantId: '8', quantity: 1, marked: false,
    requiresAuthorization: false, hasSellingPlan: false };
  assert.equal(verify([plain], null).bucketCount, 0);
  assert.throws(() => verify([{ ...plain, requiresAuthorization: true }], null));
  // The same actual product would be accepted if its required policy fact were absent from inputs.
  assert.equal(verify([{ ...plain, requiresAuthorization: false }], null).bucketCount, 0);
});

test('no-market must be expressly enabled from independent context', () => {
  const zero = issueWholeQuote({ ...header, marketId: '0' }, members, signingKey, 20800);
  assert.throws(() => verify(complete(), zero.envelope, { ...context, marketId: '0' }));
  assert.equal(verify(complete(), zero.envelope,
    { ...context, marketId: '0', allowNoMarket: true }).bucketCount, 2);
});
