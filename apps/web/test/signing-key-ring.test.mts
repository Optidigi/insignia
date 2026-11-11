import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { loadSigningKeyRing } from '../src/server/signing-key-ring.ts';

const b64 = () => randomBytes(32).toString('base64');
const credential = { INSIGNIA_CREDENTIAL_KEY_ID: 'credential-1', INSIGNIA_CREDENTIAL_KEY_BASE64: b64() };

test('without a dedicated signing key the credential ring is used unchanged', () => {
  const ring = loadSigningKeyRing(credential);
  assert.equal(ring.currentKeyId, 'credential-1');
  assert.deepEqual(Object.keys(ring.keys), ['credential-1']);
});

test('a dedicated signing key seals; credential keys open only during an explicit transition', () => {
  const env = { ...credential, INSIGNIA_SIGNING_WRAP_KEY_ID: 'signing-1', INSIGNIA_SIGNING_WRAP_KEY_BASE64: b64() };
  const dedicated = loadSigningKeyRing(env);
  assert.equal(dedicated.currentKeyId, 'signing-1');
  assert.deepEqual(Object.keys(dedicated.keys), ['signing-1']);
  const transition = loadSigningKeyRing({ ...env, INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS: '1' });
  assert.equal(transition.currentKeyId, 'signing-1');
  assert.deepEqual(Object.keys(transition.keys).sort(), ['credential-1', 'signing-1']);
  // A dedicated ring never needs the credential key at all.
  assert.equal(
    loadSigningKeyRing({
      INSIGNIA_SIGNING_WRAP_KEY_ID: 'signing-1',
      INSIGNIA_SIGNING_WRAP_KEY_BASE64: env.INSIGNIA_SIGNING_WRAP_KEY_BASE64,
    }).currentKeyId,
    'signing-1',
  );
});

test('incomplete, malformed or colliding signing key configuration fails closed', () => {
  for (const env of [
    { ...credential, INSIGNIA_SIGNING_WRAP_KEY_BASE64: b64() },
    { ...credential, INSIGNIA_SIGNING_WRAP_KEY_ID: 'signing-1' },
    { ...credential, INSIGNIA_SIGNING_WRAP_KEY_ID: 'signing-1', INSIGNIA_SIGNING_WRAP_KEY_BASE64: 'short' },
    {
      ...credential,
      INSIGNIA_SIGNING_WRAP_KEY_ID: 'credential-1',
      INSIGNIA_SIGNING_WRAP_KEY_BASE64: b64(),
      INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS: '1',
    },
    {
      ...credential,
      INSIGNIA_SIGNING_WRAP_KEY_ID: 'signing-1',
      INSIGNIA_SIGNING_WRAP_KEY_BASE64: b64(),
      INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS: 'yes',
    },
    {
      ...credential,
      INSIGNIA_SIGNING_WRAP_KEY_ID: 'signing-1',
      INSIGNIA_SIGNING_WRAP_KEY_BASE64: b64(),
      INSIGNIA_SIGNING_WRAP_PREVIOUS_KEYS_JSON: '{"signing-1":"x"}',
    },
  ])
    assert.throws(() => loadSigningKeyRing(env));
});
