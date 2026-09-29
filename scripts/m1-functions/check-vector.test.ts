import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Test-only cross-language vector. The seed is in a labelled synthetic fixture,
// never in a production package or Function configuration.
const vector = JSON.parse(
  readFileSync(new URL('../../crates/cart-authorization/fixtures/vectors.json', import.meta.url), 'utf8'),
);

test('TypeScript/Node and Rust share the exact experimental-v2 envelope/member bytes', () => {
  const header = Buffer.from(vector.headerHex, 'hex');
  const members: Buffer[] = vector.memberHex.map((hex: string) => Buffer.from(hex, 'hex'));
  const envelope = Buffer.from(vector.envelope, 'base64url');
  assert.equal(header.length, 92);
  assert.equal(envelope.length, 156);
  assert.equal(header.toString('ascii', 0, 4), 'ISG2');
  assert.equal(header.readUInt16BE(6), vector.expected.keyId);
  assert.equal(header.readUInt16BE(60), members.length);
  assert.equal(header.toString('ascii', 62, 65), vector.expected.currency);
  assert.equal(header.readUInt8(65), vector.expected.exponent);
  assert.equal(header.readUInt32BE(80), vector.expected.totalQuantity);
  assert.equal(header.readBigUInt64BE(84).toString(), vector.expected.totalMinor);
  assert.deepEqual(envelope.subarray(0, 92), header);

  let quantity = 0;
  let total = 0n;
  for (const [index, member] of members.entries()) {
    const expected = vector.expected.members[index];
    assert.equal(member.length, 22);
    assert.equal(member.readUInt16BE(0), expected.index);
    assert.equal(member.readBigUInt64BE(2).toString(), expected.variantId);
    assert.equal(member.readUInt32BE(10), expected.quantity);
    assert.equal(member.readBigUInt64BE(14).toString(), expected.unitMinor);
    assert.equal(Buffer.from(vector.memberTokens[index], 'base64url').toString('hex'), member.toString('hex'));
    quantity += expected.quantity;
    total += BigInt(expected.quantity) * BigInt(expected.unitMinor);
  }
  assert.equal(quantity, vector.expected.totalQuantity);
  assert.equal(total.toString(), vector.expected.totalMinor);

  const seed = Buffer.from(vector.seedHex, 'hex');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  assert.equal(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), vector.publicHex);
  const signed = Buffer.concat([Buffer.from(vector.domainUtf8Hex, 'hex'), header, ...members]);
  const signature = sign(null, signed, privateKey);
  assert.equal(signature.toString('hex'), vector.signatureHex);
  assert.deepEqual(envelope.subarray(92), signature);
  assert.ok(verify(null, signed, publicKey, signature));
});
