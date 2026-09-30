import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from 'node:crypto';

export type KeyScope = {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
};
export type SigningKeyRing = { currentKeyId: string; keys: Readonly<Record<string, Uint8Array>> };
export type SigningEnvelope = { v: 1; kid: string; nonce: string; ciphertext: string; tag: string };

const P = (1n << 255n) - 19n;
const mod = (n: bigint) => ((n % P) + P) % P;
function pow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  for (let n = exponent, x = mod(base); n > 0n; n >>= 1n, x = mod(x * x)) if (n & 1n) result = mod(result * x);
  return result;
}
const D = mod(-121665n * pow(121666n, P - 2n));
const SQRT_MINUS_ONE = pow(2n, (P - 1n) / 4n);
type Point = { x: bigint; y: bigint };
function add(a: Point, b: Point): Point {
  const xy = mod(D * a.x * b.x * a.y * b.y);
  return {
    x: mod((a.x * b.y + a.y * b.x) * pow(mod(1n + xy), P - 2n)),
    y: mod((a.y * b.y + a.x * b.x) * pow(mod(1n - xy), P - 2n)),
  };
}

/** Mirror the Rust verifier's canonical decompression and weak-point admission. */
export function admitPublicKey(value: Uint8Array): Buffer {
  if (value.byteLength !== 32) throw new TypeError('Invalid Ed25519 public key');
  const bytes = Buffer.from(value);
  const sign = bytes.readUInt8(31) >> 7;
  bytes.writeUInt8(bytes.readUInt8(31) & 0x7f, 31);
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(bytes.readUInt8(i));
  if (y >= P) throw new TypeError('Noncanonical Ed25519 public key');
  const y2 = mod(y * y);
  const x2 = mod((y2 - 1n) * pow(mod(D * y2 + 1n), P - 2n));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x) !== x2) x = mod(x * SQRT_MINUS_ONE);
  if (mod(x * x) !== x2 || (x === 0n && sign === 1)) throw new TypeError('Invalid Ed25519 public key');
  if (Number(x & 1n) !== sign) x = mod(-x);
  let point = { x, y };
  for (let i = 0; i < 3; i++) point = add(point, point);
  if (point.x === 0n && point.y === 1n) throw new TypeError('Weak Ed25519 public key');
  return Buffer.from(value);
}

export function publicKeyFromSeed(seed: Uint8Array): Buffer {
  if (seed.byteLength !== 32) throw new TypeError('Ed25519 seed must be 32 bytes');
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  return admitPublicKey(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32));
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
  const cipher = createCipheriv('aes-256-gcm', wrappingKey(ring, kid), nonce);
  cipher.setAAD(aad(scope, keyId));
  const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
  return {
    v: 1,
    kid,
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
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
  }
}
