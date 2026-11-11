import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import type { SigningKeyRing } from '@insignia/application';

/** Fixed in-container path of the signing wrapping-key file (bind-mounted read-only, host 0600). */
export const SIGNING_WRAP_KEY_FILE = '/run/insignia/signing-wrap-keys.json';

function keyId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value);
}
function canonicalKey(encoded: unknown): Buffer {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error('Signing wrapping key file is invalid');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Signing wrapping key file is invalid');
  return key;
}

/**
 * Parses the signing wrapping-key file:
 * `{"version":1,"currentKeyId":"<id>","keys":{"<id>":"<base64 of 32 bytes>", ...}}`
 * with 1–4 keys. New envelopes are sealed with `currentKeyId`; the others only open envelopes
 * during a KEK rotation until `--rewrap` has re-sealed them.
 */
export function parseSigningWrapKeys(text: string): SigningKeyRing & { keys: Readonly<Record<string, Buffer>> } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Signing wrapping key file is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Signing wrapping key file is invalid');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'currentKeyId,keys,version' || input.version !== 1)
    throw new Error('Signing wrapping key file is invalid');
  const entries =
    input.keys && typeof input.keys === 'object' && !Array.isArray(input.keys) ? Object.entries(input.keys) : [];
  if (entries.length < 1 || entries.length > 4 || entries.some(([id]) => !keyId(id)) || !keyId(input.currentKeyId))
    throw new Error('Signing wrapping key file is invalid');
  const keys = Object.fromEntries(entries.map(([id, encoded]) => [id, canonicalKey(encoded)]));
  if (!Object.hasOwn(keys, input.currentKeyId)) throw new Error('Signing wrapping key file is invalid');
  return { currentKeyId: input.currentKeyId, keys };
}

/**
 * Reads the file without following links. It must be a regular file owned by the signer's own uid
 * (not the web runtime's), readable by that owner only (mode 0400 or 0600).
 */
export function loadSigningWrapKeys(path = SIGNING_WRAP_KEY_FILE) {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error('Signing wrapping key file unavailable');
  }
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      ![0o400, 0o600].includes(stat.mode & 0o777) ||
      stat.size > 4096
    )
      throw new Error('Signing wrapping key file custody is invalid');
    const bytes = readFileSync(descriptor);
    try {
      return parseSigningWrapKeys(bytes.toString('utf8'));
    } finally {
      bytes.fill(0);
    }
  } finally {
    closeSync(descriptor);
  }
}
