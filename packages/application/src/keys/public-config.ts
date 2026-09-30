import { createHash } from 'node:crypto';
import { admitPublicKey, type KeyScope } from './crypto.js';

export type PublicSigningKey = {
  id: number;
  publicKey: Uint8Array;
  state: 'pending' | 'active' | 'retiring' | 'revoked' | 'destroyed';
  firstDay: number;
  lastDay: number;
};
export type PublicConfig = {
  value: string;
  digest: string;
  scope: KeyScope;
  keys: readonly {
    id: number;
    publicHex: string;
    revoked: boolean;
    firstDay: number;
    lastDay: number;
    state: PublicSigningKey['state'];
  }[];
};

/** Exact JSON field order is deliberate; the Rust parser admits at most four keys. */
export function buildPublicConfig(input: { scope: KeyScope; keys: readonly PublicSigningKey[] }): PublicConfig {
  const { scope } = input;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scope.authorizationGeneration) ||
    !Number.isInteger(scope.authorizationEpoch) ||
    scope.authorizationEpoch < 0 ||
    scope.authorizationEpoch > 0xffffffff
  )
    throw new TypeError('Invalid authorization identity');
  // A pending key must be visible to both Functions before it can be selected for issuance.
  const ordered = [...input.keys].filter((key) => key.state !== 'destroyed').sort((a, b) => a.id - b.id);
  if (ordered.length < 1 || ordered.length > 4) throw new Error('Function key count is out of bounds');
  const seen = new Set<number>();
  const keys = ordered.map((key) => {
    if (
      !Number.isInteger(key.id) ||
      key.id < 1 ||
      key.id > 65535 ||
      seen.has(key.id) ||
      !Number.isInteger(key.firstDay) ||
      !Number.isInteger(key.lastDay) ||
      key.firstDay < 0 ||
      key.lastDay > 0xffffffff ||
      key.firstDay > key.lastDay
    )
      throw new TypeError('Invalid Function key');
    seen.add(key.id);
    return {
      id: key.id,
      publicHex: admitPublicKey(key.publicKey).toString('hex'),
      revoked: key.state === 'revoked',
      firstDay: key.firstDay,
      lastDay: key.lastDay,
      state: key.state,
    };
  });
  const value = JSON.stringify({
    generationHex: scope.authorizationGeneration.replaceAll('-', ''),
    epoch: scope.authorizationEpoch,
    maxBuckets: 32,
    maxPhysicalQuantity: 10000,
    allowNoMarket: false,
    keys: keys.map(({ state: _state, ...visible }) => visible),
  });
  if (Buffer.byteLength(value) > 8000) throw new Error('Function config exceeds publication headroom');
  return { value, digest: createHash('sha256').update(value).digest('hex'), scope, keys };
}

export function requireIssuanceReady(input: { config: PublicConfig; keyId: number; acceptedDay: number }): void {
  if (!Number.isInteger(input.acceptedDay) || input.acceptedDay < 0 || input.acceptedDay > 0xffffffff - 2)
    throw new Error('Invalid accepted day');
  const key = input.config.keys.find((candidate) => candidate.id === input.keyId);
  if (key?.state !== 'active' || key.revoked || key.firstDay > input.acceptedDay || key.lastDay < input.acceptedDay + 2)
    throw new Error('Signing key is not issuance ready');
}
