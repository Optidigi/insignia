import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { publicKeyFromSeed } from '../../src/keys/crypto.js';
import { buildPublicConfig, type PublicSigningKey, publishedConfigMatches } from '../../src/keys/public-config.js';
import { assertQuoteIssuanceReady, PublicConfigDriftError } from '../../src/keys/readiness.js';

const scope = {
  shopId: 'shop',
  installationGeneration: '1',
  authorizationGeneration: 'd79cc783-c5d4-4af9-881b-825129a74b1c',
  authorizationEpoch: 0,
};
const key = (id: number, state: PublicSigningKey['state'], firstDay: number, lastDay: number): PublicSigningKey => ({
  id,
  publicKey: publicKeyFromSeed(randomBytes(32)),
  state,
  firstDay,
  lastDay,
});
// 12 Nov 2026 00:28Z: UTC day 20769.
const now = new Date('2026-11-12T00:28:00.000Z');
const key1 = key(1, 'retiring', 20736, 20767);
const key2 = key(2, 'retiring', 20766, 20771);
const key3 = key(3, 'active', 20768, 0x7fffffff);
// What the rotation published on 11 Nov: keys 1, 2 and 3.
const published = buildPublicConfig({ scope, keys: [key1, key2, key3] }).value;

describe('published Function config comparison', () => {
  it('regression 12 Nov 2026: key 1 destroyed by the daily job but still published still matches', () => {
    const desired = buildPublicConfig({ scope, keys: [{ ...key1, state: 'destroyed' }, key2, key3], now });
    expect(desired.value).not.toBe(published);
    expect(desired.closedDestroyed.map((k) => k.id)).toEqual([1]);
    expect(publishedConfigMatches(desired, published)).toBe(true);
    // The exact expected value still matches, and readiness accepts the older published copy.
    expect(publishedConfigMatches(desired, desired.value)).toBe(true);
  });

  it('a destroyed key whose window is still open does not match', () => {
    // Key 2 destroyed early (window to 20771 still open on day 20769).
    const desired = buildPublicConfig({ scope, keys: [key1, { ...key2, state: 'destroyed' }, key3], now });
    expect(desired.closedDestroyed).toEqual([]);
    expect(publishedConfigMatches(desired, published)).toBe(false);
  });

  it('an extra unknown key does not match', () => {
    const desired = buildPublicConfig({ scope, keys: [{ ...key1, state: 'destroyed' }, key2, key3], now });
    const unknown = buildPublicConfig({ scope, keys: [key2, key3, key(4, 'retiring', 20700, 20701)] }).value;
    expect(publishedConfigMatches(desired, unknown)).toBe(false);
    // Same id as the destroyed key but a different public key is also unknown.
    const swapped = buildPublicConfig({ scope, keys: [key(1, 'retiring', 20736, 20767), key2, key3] }).value;
    expect(publishedConfigMatches(desired, swapped)).toBe(false);
  });

  it('a missing active key or any other drift does not match', () => {
    const desired = buildPublicConfig({ scope, keys: [{ ...key1, state: 'destroyed' }, key2, key3], now });
    expect(publishedConfigMatches(desired, buildPublicConfig({ scope, keys: [key1, key2] }).value)).toBe(false);
    expect(
      publishedConfigMatches(
        desired,
        buildPublicConfig({ scope: { ...scope, authorizationEpoch: 1 }, keys: [key1, key2, key3] }).value,
      ),
    ).toBe(false);
    expect(publishedConfigMatches(desired, null)).toBe(false);
    expect(publishedConfigMatches(desired, '{')).toBe(false);
  });

  it('readiness reports an unexplained difference as drift', () => {
    const desired = buildPublicConfig({ scope, keys: [key1, key2, key3], now });
    expect(() =>
      assertQuoteIssuanceReady({
        scope,
        selectedKeyId: 3,
        acceptedDay: 20769,
        desired,
        observed: { value: buildPublicConfig({ scope, keys: [key2, key3] }).value, observedAt: now } as never,
        now,
        maxObservationAgeMs: 30_000,
        functions: { transform: 'present', validation: 'present' },
        effectiveRevision: true,
        artifact: { appClientId: 'app', expectedBuild: null, attestation: null },
      } as never),
    ).toThrow(PublicConfigDriftError);
  });
});
