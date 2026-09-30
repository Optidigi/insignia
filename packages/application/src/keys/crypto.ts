import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';

export type KeyScope = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
};
export type SigningKeyRing = { currentKeyId: string; keys: Readonly<Record<string, Uint8Array>> };
export type SigningEnvelope = { v: 1; kid: string; nonce: string; ciphertext: string; tag: string };

/** Strict canonical decode and weak-point rejection via the maintained curve library. */
export function admitPublicKey(value: Uint8Array): Buffer {
  if (value.byteLength !== 32) throw new TypeError('Invalid Ed25519 public key');
  const point = ed25519.Point.fromBytes(value, false);
  if (point.isSmallOrder()) throw new TypeError('Weak Ed25519 public key');
  return Buffer.from(value);
}

export function publicKeyFromSeed(seed: Uint8Array): Buffer {
  if (seed.byteLength !== 32) throw new TypeError('Ed25519 seed must be 32 bytes');
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]);
  try {
    const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    return admitPublicKey(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32));
  } finally {
    pkcs8.fill(0);
  }
}

export function publicKeyFingerprint(publicKey: Uint8Array): string {
  return createHash('sha256').update(admitPublicKey(publicKey)).digest('hex');
}

function aad(scope: KeyScope, keyId: number): Buffer {
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 65535) throw new TypeError('Invalid signing key ID');
  return Buffer.from(
    JSON.stringify([
      'insignia-signing-key',
      1,
      scope.shopId,
      scope.installationGeneration,
      scope.authorizationGeneration,
      keyId,
    ]),
  );
}
function wrappingKey(ring: SigningKeyRing | undefined, id: string): Buffer {
  const key = ring?.keys[id];
  if (key?.byteLength !== 32) throw new Error('Signing wrapping key unavailable');
  return Buffer.from(key);
}
export function sealSigningSeed(
  ring: SigningKeyRing | undefined,
  scope: KeyScope,
  keyId: number,
  seed: Uint8Array,
): SigningEnvelope {
  if (seed.byteLength !== 32) throw new TypeError('Ed25519 seed must be 32 bytes');
  const kid = ring?.currentKeyId;
  if (!kid) throw new Error('Signing wrapping key unavailable');
  const nonce = randomBytes(12);
  const key = wrappingKey(ring, kid);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(scope, keyId));
    const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
    return {
      v: 1,
      kid,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  } finally {
    key.fill(0);
  }
}
export function openSigningSeed(
  ring: SigningKeyRing | undefined,
  scope: KeyScope,
  keyId: number,
  value: unknown,
): Buffer {
  if (!value || typeof value !== 'object') throw new Error('Invalid signing envelope');
  const envelope = value as Partial<SigningEnvelope>;
  if (
    envelope.v !== 1 ||
    typeof envelope.kid !== 'string' ||
    typeof envelope.nonce !== 'string' ||
    typeof envelope.ciphertext !== 'string' ||
    typeof envelope.tag !== 'string'
  )
    throw new Error('Invalid signing envelope');
  const key = wrappingKey(ring, envelope.kid);
  try {
    const nonce = Buffer.from(envelope.nonce, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    if (nonce.length !== 12 || ciphertext.length !== 32 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(scope, keyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error('Signing envelope authentication failed');
  } finally {
    key.fill(0);
  }
}
