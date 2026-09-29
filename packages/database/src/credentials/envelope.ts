import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type CredentialKeyRing = {
  currentKeyId: string;
  keys: Readonly<Record<string, Uint8Array>>;
};

export type TokenKind = 'access' | 'refresh';

export class MissingCredentialKeyError extends Error {
  constructor() {
    super('Credential wrapping key is unavailable');
    this.name = 'MissingCredentialKeyError';
  }
}

export class CredentialAuthenticationError extends Error {
  constructor() {
    super('Credential envelope authentication failed');
    this.name = 'CredentialAuthenticationError';
  }
}

type Envelope = { v: 1; kid: string; nonce: string; ciphertext: string; tag: string };

function keyFor(ring: CredentialKeyRing | undefined, id: string): Buffer {
  const key = ring?.keys[id];
  if (key?.byteLength !== 32) throw new MissingCredentialKeyError();
  return Buffer.from(key);
}

function aad(shopId: string, generation: string, version: string, kind: TokenKind): Buffer {
  return Buffer.from(JSON.stringify(['insignia-shop-credential-v1', shopId, generation, version, kind]));
}

export function sealCredential(
  ring: CredentialKeyRing | undefined,
  shopId: string,
  generation: string,
  version: string,
  kind: TokenKind,
  value: string,
): Envelope {
  if (!value || value.length > 8192) throw new TypeError('Invalid credential value');
  const id = ring?.currentKeyId;
  if (!id) throw new MissingCredentialKeyError();
  const key = keyFor(ring, id);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(shopId, generation, version, kind));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    v: 1,
    kid: id,
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

export function openCredential(
  ring: CredentialKeyRing | undefined,
  shopId: string,
  generation: string,
  version: string,
  kind: TokenKind,
  value: unknown,
): string {
  if (!value || typeof value !== 'object') throw new CredentialAuthenticationError();
  const envelope = value as Partial<Envelope>;
  if (
    envelope.v !== 1 ||
    typeof envelope.kid !== 'string' ||
    typeof envelope.nonce !== 'string' ||
    typeof envelope.ciphertext !== 'string' ||
    typeof envelope.tag !== 'string'
  )
    throw new CredentialAuthenticationError();
  const key = keyFor(ring, envelope.kid);
  try {
    const nonce = Buffer.from(envelope.nonce, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    if (nonce.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength === 0) {
      throw new CredentialAuthenticationError();
    }
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad(shopId, generation, version, kind));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new CredentialAuthenticationError();
  }
}
