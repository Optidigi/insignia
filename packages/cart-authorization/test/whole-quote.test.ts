import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DOMAIN,
  decodeEnvelope,
  decodeMemberCarrier,
  encodeHeader,
  encodeMember,
  InjectedEd25519Signer,
  issueWholeQuote,
  wholeQuoteSignBytes,
} from '../src/whole-quote.ts';

const literal = JSON.parse(
  readFileSync(new URL('../../../crates/cart-authorization/fixtures/vectors.json', import.meta.url), 'utf8'),
);
const header = literal.expected;
const members = header.members;
const { members: _members, ...claims } = header;

test('production decoder and signature bytes preserve the independent v2 wire literal', () => {
  const decoded = decodeEnvelope(literal.envelope);
  assert.deepEqual(decoded.header, claims);
  assert.deepEqual(literal.memberTokens.map(decodeMemberCarrier), members);
  assert.equal(encodeHeader(claims).toString('hex'), literal.headerHex);
  assert.deepEqual(
    members.map((member: (typeof members)[number]) => encodeMember(member).toString('hex')),
    literal.memberHex,
  );
  assert.equal(DOMAIN.toString('hex'), literal.domainUtf8Hex);
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(literal.publicHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(verify(null, wholeQuoteSignBytes(claims, members), publicKey, decoded.signature), true);
});

test('injected synthetic Ed25519 signer covers the complete set and three-day key window', async () => {
  const derivedSyntheticSeed = createHash('sha256').update('Insignia M4-002 synthetic signer test').digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), derivedSyntheticSeed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const signer = new InjectedEd25519Signer({
    getSigningKey: async () => ({
      key: privateKey,
      keyId: 7,
      publicKeyFingerprint: 'synthetic-test-key',
      revoked: false,
      firstValidDay: 20800,
      lastValidDay: 20802,
    }),
  });
  const issued = await issueWholeQuote(claims, members, 20800, signer);
  assert.equal(issued.members.length, members.length);
  assert.equal(
    verify(null, wholeQuoteSignBytes(claims, members), publicKey, decodeEnvelope(issued.envelope).signature),
    true,
  );
  const revokedSigner = new InjectedEd25519Signer({
    getSigningKey: async () => ({
      key: privateKey,
      keyId: 7,
      publicKeyFingerprint: 'synthetic-test-key',
      revoked: true,
      firstValidDay: 20800,
      lastValidDay: 20802,
    }),
  });
  await assert.rejects(issueWholeQuote(claims, members, 20800, revokedSigner), /key validity/);
});

test('invalid window or set refuses signing and noncanonical carrier refuses decoding', async () => {
  let calls = 0;
  const signer = {
    signWholeQuote: async () => {
      calls++;
      return {
        keyId: 7,
        publicKeyFingerprint: 'synthetic',
        firstValidDay: 20801,
        lastValidDay: 20802,
        signature: Buffer.alloc(64),
      };
    },
  };
  await assert.rejects(issueWholeQuote(claims, members, 20800, signer), /key validity/);
  assert.equal(calls, 1);
  await assert.rejects(issueWholeQuote(claims, [...members].reverse(), 20800, signer), /index/);
  assert.equal(calls, 1);
  assert.throws(() => decodeEnvelope(`${literal.envelope}=`), /carrier/);
  assert.throws(() => decodeMemberCarrier(`${literal.memberTokens[0]}=`), /carrier/);
});
