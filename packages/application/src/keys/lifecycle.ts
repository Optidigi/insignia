import { randomBytes } from 'node:crypto';
import {
  type KeyScope,
  openSigningSeed,
  publicKeyFingerprint,
  publicKeyFromSeed,
  type SigningEnvelope,
  type SigningKeyRing,
  sealSigningSeed,
} from './crypto.js';
import { buildPublicConfig, type PublicConfig, type PublicSigningKey } from './public-config.js';

export type DurableSigningKey = PublicSigningKey & {
  shopId: string;
  installationGeneration: string;
  authorizationGeneration: string;
  keyId: number;
  publicKeyFingerprint: string;
  privateEnvelope: unknown | null;
  wrappingKeyId: string | null;
};
export interface SigningKeyStore {
  getActiveScope(shopId: string, installationGeneration: string): Promise<KeyScope | null>;
  list(scope: KeyScope): Promise<readonly DurableSigningKey[]>;
  createPending(input: {
    scope: KeyScope;
    keyId: number;
    publicKey: Uint8Array;
    publicKeyFingerprint: string;
    privateEnvelope: SigningEnvelope;
    wrappingKeyId: string;
    firstDay: number;
    lastDay: number;
  }): Promise<void>;
  activate(scope: KeyScope, keyId: number): Promise<void>;
  revoke(scope: KeyScope, keyId: number, commandKey: string, reason: string): Promise<void>;
  destroy(scope: KeyScope, keyId: number): Promise<void>;
  incrementEpoch(input: { scope: KeyScope; commandKey: string; requestDigest: string }): Promise<number>;
}

function requireScope(actual: KeyScope | null, expected: KeyScope): void {
  if (
    !actual ||
    actual.shopId !== expected.shopId ||
    actual.installationGeneration !== expected.installationGeneration ||
    actual.authorizationGeneration !== expected.authorizationGeneration ||
    actual.authorizationEpoch !== expected.authorizationEpoch
  )
    throw new Error('Inactive or stale signing installation');
}

export class SigningKeyLifecycle {
  constructor(
    private readonly store: SigningKeyStore,
    private readonly ring: SigningKeyRing,
  ) {}

  /** The seed exists only in caller memory and the authenticated envelope; durable storage receives ciphertext. */
  async createPending(input: {
    scope: KeyScope;
    keyId: number;
    firstDay: number;
    lastDay: number;
    seed?: Uint8Array;
  }): Promise<{ publicKeyFingerprint: string }> {
    requireScope(await this.store.getActiveScope(input.scope.shopId, input.scope.installationGeneration), input.scope);
    const seed = input.seed ? Buffer.from(input.seed) : randomBytes(32);
    try {
      const publicKey = publicKeyFromSeed(seed);
      const publicKeyFingerprintValue = publicKeyFingerprint(publicKey);
      const envelope = sealSigningSeed(this.ring, input.scope, input.keyId, seed);
      await this.store.createPending({
        scope: input.scope,
        keyId: input.keyId,
        publicKey,
        publicKeyFingerprint: publicKeyFingerprintValue,
        privateEnvelope: envelope,
        wrappingKeyId: envelope.kid,
        firstDay: input.firstDay,
        lastDay: input.lastDay,
      });
      return { publicKeyFingerprint: publicKeyFingerprintValue };
    } finally {
      seed.fill(0);
    }
  }

  async activate(scope: KeyScope, keyId: number): Promise<void> {
    await this.store.activate(scope, keyId);
  }
  async revoke(scope: KeyScope, keyId: number, commandKey: string, reason: string): Promise<void> {
    await this.store.revoke(scope, keyId, commandKey, reason);
  }
  async destroy(scope: KeyScope, keyId: number): Promise<void> {
    // The durable store enforces a conservative UTC/timezone destruction window.
    await this.store.destroy(scope, keyId);
  }
  async incrementEpoch(input: { scope: KeyScope; commandKey: string; requestDigest: string }): Promise<number> {
    return this.store.incrementEpoch(input);
  }
  async desiredPublicConfig(scope: KeyScope): Promise<PublicConfig> {
    requireScope(await this.store.getActiveScope(scope.shopId, scope.installationGeneration), scope);
    const keys = await this.store.list(scope);
    for (const key of keys) {
      if (
        key.shopId !== scope.shopId ||
        key.installationGeneration !== scope.installationGeneration ||
        key.authorizationGeneration !== scope.authorizationGeneration ||
        key.keyId !== key.id ||
        publicKeyFingerprint(key.publicKey) !== key.publicKeyFingerprint
      )
        throw new Error('Signing key metadata drift');
    }
    return buildPublicConfig({ scope, keys });
  }
  async openActiveSeed(scope: KeyScope, keyId: number): Promise<Buffer> {
    requireScope(await this.store.getActiveScope(scope.shopId, scope.installationGeneration), scope);
    const keys = await this.store.list(scope);
    const key = keys.find((candidate) => candidate.id === keyId);
    if (
      key?.state !== 'active' ||
      !key.privateEnvelope ||
      !key.wrappingKeyId ||
      typeof key.privateEnvelope !== 'object' ||
      (key.privateEnvelope as { kid?: unknown }).kid !== key.wrappingKeyId
    )
      throw new Error('Active signing key unavailable');
    const seed = openSigningSeed(this.ring, scope, keyId, key.privateEnvelope);
    try {
      if (
        !publicKeyFromSeed(seed).equals(Buffer.from(key.publicKey)) ||
        publicKeyFingerprint(key.publicKey) !== key.publicKeyFingerprint
      )
        throw new Error('Signing key pair mismatch');
      return seed;
    } catch {
      seed.fill(0);
      throw new Error('Signing key pair mismatch');
    }
  }
}
