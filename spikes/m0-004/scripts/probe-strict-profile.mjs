import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeAndVerifyToken, publicKeyFromHex } from '../ts/authorization.ts';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/vectors.json', import.meta.url), 'utf8'));
const named = new Map(corpus.invalid.map(vector => [vector.name, vector]));
const ordinaryKey = publicKeyFromHex(corpus.publicKeyHex);
const check = (name, publicHex) => {
  const vector = named.get(name);
  assert.ok(vector, `missing vector: ${name}`);
  const key = publicKeyFromHex(publicHex);
  try {
    decodeAndVerifyToken(vector.token, new Map([[7, key]]));
    return { name, accepted: true, rejection: null };
  } catch (error) {
    return { name, accepted: false, rejection: error instanceof Error ? error.message : String(error) };
  }
};

const weak = named.get('weak_identity_key_r_identity_s_zero');
assert.ok(weak?.publicKeyHex);
const cases = [
  check(weak.name, weak.publicKeyHex),
  check('normal_key_rejects_identity_signature', corpus.publicKeyHex),
  check('noncanonical_signature_scalar', corpus.publicKeyHex),
];
for (const result of cases) {
  assert.deepEqual({ accepted: result.accepted, rejection: result.rejection },
    { accepted: false, rejection: 'invalid signature' }, result.name);
}
const normal = decodeAndVerifyToken(corpus.valid[0].token, new Map([[7, ordinaryKey]]));
assert.equal(normal.variantId, corpus.valid[0].claims.variantId);

console.log(JSON.stringify({
  runtime: { node: process.version, openssl: process.versions.openssl },
  profile: 'Observed pinned Node/OpenSSL rejection for the named identity-key, normal-key and noncanonical-S cases; no claim of general hostile-key equivalence',
  identityPublicKeyHex: weak.publicKeyHex,
  forgedSignatureHex: Buffer.from(weak.token, 'base64url').subarray(114).toString('hex'),
  normalPublicKeyHex: corpus.publicKeyHex,
  normalSignedControlAccepted: true,
  cases,
}, null, 2));
