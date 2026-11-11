import type { SigningKeyRing } from '@insignia/application';
import { loadCredentialKeys } from '../../../worker/src/config.ts';

function keyId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
}
function canonicalKey(encoded: unknown): Buffer {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error('Signing wrapping key is invalid');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Signing wrapping key is invalid');
  return key;
}

/**
 * Wrapping keys (KEK) for private signing seeds. A dedicated ring lives only in the web runtime
 * (`INSIGNIA_SIGNING_WRAP_KEY_ID`/`_BASE64`, optional `INSIGNIA_SIGNING_WRAP_PREVIOUS_KEYS_JSON`);
 * the worker never receives it. New envelopes are always sealed with the dedicated current key.
 * During a transition, `INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS=1` also lets it open envelopes
 * sealed earlier under the shop-credential ring; those keys are never used to seal. Without the
 * dedicated variables the credential ring is used, as before.
 */
export function loadSigningKeyRing(env: Record<string, string | undefined>): SigningKeyRing & {
  keys: Readonly<Record<string, Buffer>>;
} {
  const currentKeyId = env.INSIGNIA_SIGNING_WRAP_KEY_ID;
  if (!currentKeyId) {
    if (env.INSIGNIA_SIGNING_WRAP_KEY_BASE64 || env.INSIGNIA_SIGNING_WRAP_PREVIOUS_KEYS_JSON)
      throw new Error('Signing wrapping key configuration is incomplete');
    const credential = loadCredentialKeys(env);
    return {
      currentKeyId: credential.currentKeyId,
      keys: Object.fromEntries(Object.entries(credential.keys).map(([id, key]) => [id, Buffer.from(key)])),
    };
  }
  if (!keyId(currentKeyId)) throw new Error('Signing wrapping key configuration is incomplete');
  const keys: Record<string, Buffer> = { [currentKeyId]: canonicalKey(env.INSIGNIA_SIGNING_WRAP_KEY_BASE64) };
  const previousText = env.INSIGNIA_SIGNING_WRAP_PREVIOUS_KEYS_JSON;
  if (previousText) {
    let previous: unknown;
    try {
      previous = JSON.parse(previousText);
    } catch {
      throw new Error('Previous signing wrapping key configuration is invalid');
    }
    if (!previous || typeof previous !== 'object' || Array.isArray(previous))
      throw new Error('Previous signing wrapping key configuration is invalid');
    const entries = Object.entries(previous);
    if (entries.length > 3 || entries.some(([id]) => !keyId(id) || id in keys))
      throw new Error('Previous signing wrapping key configuration is invalid');
    for (const [id, encoded] of entries) keys[id] = canonicalKey(encoded);
  }
  if (env.INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS === '1') {
    const credential = loadCredentialKeys(env);
    for (const [id, key] of Object.entries(credential.keys)) {
      if (id in keys) throw new Error('Signing and credential wrapping key IDs must differ');
      keys[id] = Buffer.from(key);
    }
  } else if (env.INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS !== undefined)
    throw new Error('Signing wrapping key configuration is invalid');
  return { currentKeyId, keys };
}
