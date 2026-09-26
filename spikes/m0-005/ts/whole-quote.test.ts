import assert from 'node:assert/strict';
import { sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { allocateGroups, formatMinor } from '../../m0-004/ts/allocation.ts';
import { privateKeyFromSeed, publicKeyFromHex } from '../../m0-004/ts/authorization.ts';
import {
  DOMAIN, HEADER_BYTES, MEMBER_BYTES, ENVELOPE_CHARACTERS,
  encodeHeader, decodeHeader, encodeMember, decodeMember, issueWholeQuote, issueAllocatedQuote,
  type Header, type Member,
} from './whole-quote.ts';

const vector = JSON.parse(readFileSync(new URL('../fixtures/vectors.json', import.meta.url), 'utf8'));
const { members: fixtureMembers, ...fixtureHeader } = vector.expected;
const header = fixtureHeader as Header;
const members = fixtureMembers as Member[];
const privateKey = privateKeyFromSeed(vector.seedHex as string);
const publicKey = publicKeyFromHex(vector.publicHex as string);
const issued = issueWholeQuote(header, members, privateKey, 20800);
const rawHeader = () => Buffer.from(issued.envelope, 'base64url').subarray(0, HEADER_BYTES);
const rawMembers = () => issued.members.map(m => Buffer.from(m, 'base64url'));
const signedMessage = (head: Buffer, records: readonly Buffer[]) => Buffer.concat([DOMAIN, head, ...records]);
const context = {
  keyId: header.keyId, generationHex: header.generationHex, epoch: header.epoch,
  quoteHex: header.quoteHex, setHex: header.setHex, currency: header.currency,
  exponent: header.exponent, country: header.country, marketId: header.marketId,
  validThroughDay: header.validThroughDay,
};

test('canonical Python, TypeScript and Rust golden carriers agree exactly', () => {
  assert.equal(DOMAIN.toString('hex'), vector.domainUtf8Hex);
  assert.equal(encodeHeader(header).toString('hex'), vector.headerHex);
  assert.deepEqual(members.map(m => encodeMember(m).toString('hex')), vector.memberHex);
  assert.equal(issued.envelope, vector.envelope);
  assert.deepEqual(issued.members, vector.memberTokens);
  assert.equal(issued.envelope.length, ENVELOPE_CHARACTERS);
  assert.equal(encodeHeader(header).length, HEADER_BYTES);
  assert.equal(encodeMember(members[0]!).length, MEMBER_BYTES);
  assert.deepEqual(decodeHeader(rawHeader()), header);
  assert.deepEqual(decodeMember(rawMembers()[0]!), members[0]);
});

test('ordinary Ed25519 signature binds every header and member byte', () => {
  const signature = Buffer.from(issued.envelope, 'base64url').subarray(HEADER_BYTES);
  assert.equal(signature.toString('hex'), vector.signatureHex);
  assert.equal(verify(null, signedMessage(rawHeader(), rawMembers()), publicKey, signature), true);
  for (const index of [0, 1]) {
    const changed = rawMembers(); changed[index]![21] = changed[index]![21]! ^ 1;
    assert.equal(verify(null, signedMessage(rawHeader(), changed), publicKey, signature), false);
  }
  const changedHeader = rawHeader(); changedHeader[44] = changedHeader[44]! ^ 1;
  assert.equal(verify(null, signedMessage(changedHeader, rawMembers()), publicKey, signature), false);
});

test('all fifteen independently signed high-bit raw magic variants reject decoding', () => {
  for (let mask = 1; mask < 16; mask++) {
    const changedHeader = rawHeader();
    for (let bit = 0; bit < 4; bit++) if (mask & (1 << bit)) changedHeader[bit] = changedHeader[bit]! | 0x80;
    const signature = sign(null, signedMessage(changedHeader, rawMembers()), privateKey);
    assert.equal(verify(null, signedMessage(changedHeader, rawMembers()), publicKey, signature), true);
    assert.throws(() => decodeHeader(changedHeader), /header/);
  }
});

test('v2 framing rejects old magic, unknown version, flags and lengths', () => {
  const old = JSON.parse(readFileSync(new URL('../../m0-004/fixtures/targets/transform-valid.json', import.meta.url), 'utf8'));
  assert.throws(() => decodeHeader(Buffer.from(old.cart.lines[0].auth.value, 'base64url').subarray(0, HEADER_BYTES)), /header/);
  const wrongVersion = rawHeader(); wrongVersion[4] = 3;
  const wrongFlags = rawHeader(); wrongFlags[5] = 1;
  assert.throws(() => decodeHeader(wrongVersion), /header/);
  assert.throws(() => decodeHeader(wrongFlags), /header/);
  assert.throws(() => decodeHeader(rawHeader().subarray(0, 91)), /header/);
  assert.throws(() => decodeMember(rawMembers()[0]!.subarray(0, 21)), /length/);
  const highCountry = rawHeader(); highCountry[66] = 0xc4;
  assert.throws(() => decodeHeader(highCountry));
});

test('issuer rejects reordered, missing, duplicate, overflow and inconsistent totals', () => {
  assert.throws(() => issueWholeQuote(header, [...members].reverse(), privateKey, 20800));
  assert.throws(() => issueWholeQuote(header, [members[0]!], privateKey, 20800));
  assert.throws(() => issueWholeQuote(header, [members[0]!, members[0]!], privateKey, 20800));
  assert.throws(() => issueWholeQuote({ ...header, totalMinor: '9101' }, members, privateKey, 20800));
  assert.throws(() => issueWholeQuote({ ...header, totalQuantity: 4 }, members, privateKey, 20800));
  assert.throws(() => issueWholeQuote({ ...header, count: 0 }, [], privateKey, 20800));
  assert.throws(() => issueWholeQuote({ ...header, validThroughDay: 20803 }, members, privateKey, 20800));
  assert.throws(() => issueWholeQuote(header, members, publicKey, 20800));
  assert.throws(() => encodeMember({ ...members[0]!, variantId: '01' }));
  assert.throws(() => encodeMember({ ...members[0]!, quantity: 0x100000000 }));
  assert.throws(() => encodeMember({ ...members[0]!, unitMinor: '18446744073709551616' }));
  assert.throws(() => issueWholeQuote({ ...header, count: 1, totalQuantity: 2,
    totalMinor: '18446744073709551615' }, [{ index: 0, variantId: '1', quantity: 2,
    unitMinor: '18446744073709551615' }], privateKey, 20800));
});

test('new quote or renewal set identity changes signed statement', () => {
  const renewal = issueWholeQuote({ ...header, setHex: '44'.repeat(16) }, members, privateKey, 20800);
  const changedQuote = issueWholeQuote({ ...header, quoteHex: '55'.repeat(16) }, members, privateKey, 20800);
  assert.notEqual(renewal.envelope, issued.envelope);
  assert.notEqual(changedQuote.envelope, issued.envelope);
  assert.deepEqual(renewal.members, issued.members);
  assert.deepEqual(changedQuote.members, issued.members);
  assert.equal(issueWholeQuote(header, members, privateKey, 20800).envelope, issued.envelope);
});

test('existing exact-money allocator conserves the €91 non-divisible setup', () => {
  const groups = [{ groupId: 'design', setupMinor: '100', variants: [
    { variantId: members[0]!.variantId, quantity: 3, acceptedBaseUnitMinor: '3000' },
  ] }];
  const allocation = allocateGroups(groups);
  assert.equal(allocation.totalMinor, '9100');
  assert.deepEqual(allocation.buckets.map(b => [b.quantity, formatMinor(BigInt(b.unitMinor), 2)]),
    [[1, '30.34'], [2, '30.33']]);
  const accepted = issueAllocatedQuote(groups, context, privateKey, 20800);
  assert.equal(accepted.header.totalMinor, '9100');
  assert.equal(accepted.members.length, 2);
  assert.notEqual(accepted.envelope, issued.envelope); // allocator's canonical bucket order differs from the literal vector
});

test('500-unit two-group tier is allocated, signed and conserved independently', () => {
  const groups = [
    { groupId: 'shirts', setupMinor: '3500', variants: [
      { variantId: '10', quantity: 250, acceptedBaseUnitMinor: '2300' },
    ] },
    { groupId: 'hoodies', setupMinor: '5000', variants: [
      { variantId: '20', quantity: 250, acceptedBaseUnitMinor: '3500' },
    ] },
  ];
  const allocation = allocateGroups(groups);
  assert.equal(allocation.totalQuantity, 500);
  assert.equal(allocation.totalMinor, '1458500'); // plan example: €14,585
  assert.deepEqual(Object.fromEntries(allocation.buckets.map(b => [b.variantId, b.unitMinor])),
    { '10': '2314', '20': '3520' });
  const accepted = issueAllocatedQuote(groups, context, privateKey, 20800);
  assert.equal(accepted.header.totalMinor, '1458500');
  assert.equal(accepted.members.length, 2);
  assert.equal(accepted.carriers.length, 2);
});

test('10,000 units in five buckets use bounded records without per-unit materialization', () => {
  const groups = [0, 1, 2, 3, 4].map(i => ({ groupId: `group${i}`, setupMinor: '0', variants: [
    { variantId: String(100 + i), quantity: 2000, acceptedBaseUnitMinor: '100' },
  ] }));
  const accepted = issueAllocatedQuote(groups, context, privateKey, 20800);
  assert.equal(accepted.header.totalQuantity, 10000);
  assert.equal(accepted.header.totalMinor, '1000000');
  assert.equal(accepted.members.length, 5);
});

test('shop-local issuance day bounds include day zero and maximum u32', () => {
  const one = [{ index: 0, variantId: '5', quantity: 1, unitMinor: '100' }];
  for (const [day, expiry] of [[0, 2], [0xfffffffd, 0xffffffff]]) {
    assert.equal(issueWholeQuote({ ...header, count: 1, totalQuantity: 1, totalMinor: '100',
      validThroughDay: expiry! }, one, privateKey, day!).members.length, 1);
  }
  assert.throws(() => issueWholeQuote({ ...header, validThroughDay: 20804 }, members, privateKey, 20800));
});
