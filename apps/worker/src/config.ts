import type { CredentialKeyRing } from '@insignia/database';

function canonicalKey(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Credential wrapping key is invalid');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Credential wrapping key is invalid');
  return key;
}

function keyId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
}

/** All key material is injected; previous IDs remain until their envelopes are rewrapped. */
export function loadCredentialKeys(environment: Record<string, string | undefined>): CredentialKeyRing {
  const currentKeyId = environment.INSIGNIA_CREDENTIAL_KEY_ID;
  const currentEncoded = environment.INSIGNIA_CREDENTIAL_KEY_BASE64;
  if (!currentKeyId || !keyId(currentKeyId) || !currentEncoded)
    throw new Error('Credential wrapping key configuration is incomplete');
  const keys: Record<string, Uint8Array> = { [currentKeyId]: canonicalKey(currentEncoded) };
  const previousText = environment.INSIGNIA_CREDENTIAL_PREVIOUS_KEYS_JSON;
  if (previousText) {
    let previous: unknown;
    try {
      previous = JSON.parse(previousText);
    } catch {
      throw new Error('Previous credential wrapping key configuration is invalid');
    }
    if (!previous || typeof previous !== 'object' || Array.isArray(previous))
      throw new Error('Previous credential wrapping key configuration is invalid');
    const entries = Object.entries(previous);
    if (entries.length > 3 || entries.some(([id]) => !keyId(id) || id === currentKeyId))
      throw new Error('Previous credential wrapping key configuration is invalid');
    for (const [id, encoded] of entries) {
      if (typeof encoded !== 'string') throw new Error('Previous credential wrapping key configuration is invalid');
      keys[id] = canonicalKey(encoded);
    }
  }
  return { currentKeyId, keys };
}
