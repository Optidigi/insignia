import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { publicKeyFromSeed } from '../../src/keys/crypto.js';
import {
  buildPublicConfig,
  type PublicSigningKey,
  publishedConfigMatches,
  rotationMayRepublish,
} from '../../src/keys/public-config.js';
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

describe('rotation republish pre-check (#334)', () => {
  const NON_EXPIRING = 0x7fffffff;
  const today = 20769;
  const active = key(1, 'active', 20700, NON_EXPIRING);
  // Rotation to key 2: the outgoing key is shortened to today + 3 before publication.
  const shortened = { ...active, lastDay: today + 3 };
  const pending = key(2, 'pending', today, NON_EXPIRING);
  const before = buildPublicConfig({ scope, keys: [active] }).value;

  it('accepts the exact expected config', () => {
    const desired = buildPublicConfig({ scope, keys: [shortened, pending], now });
    expect(rotationMayRepublish(desired, desired.value, 2)).toBe(true);
  });

  it('accepts what a rotation of this plan left when it stopped before publishing', () => {
    // Stopped after creating the pending key, before shortening the outgoing key.
    expect(rotationMayRepublish(buildPublicConfig({ scope, keys: [active, pending], now }), before, 2)).toBe(true);
    // Stopped after shortening the outgoing key.
    const desired = buildPublicConfig({ scope, keys: [shortened, pending], now });
    expect(rotationMayRepublish(desired, before, 2)).toBe(true);
    // Quote readiness stays exact: issuance stops until the rotation is resumed.
    expect(publishedConfigMatches(desired, before)).toBe(false);
    // Only the pending key of this plan may be missing.
    expect(rotationMayRepublish(desired, before, 3)).toBe(false);
    expect(rotationMayRepublish(desired, before, 1)).toBe(false);
  });

  it('accepts an earlier publication that an epoch bump or revocation has since tightened', () => {
    const bumped = { ...scope, authorizationEpoch: 1 };
    expect(rotationMayRepublish(buildPublicConfig({ scope: bumped, keys: [active], now }), before, 2)).toBe(true);
    const revoked = { ...active, state: 'revoked' as const, lastDay: today + 3 };
    expect(rotationMayRepublish(buildPublicConfig({ scope, keys: [revoked], now }), before, 2)).toBe(true);
    // Both, and a pending key of this plan, together.
    expect(rotationMayRepublish(buildPublicConfig({ scope: bumped, keys: [revoked, pending], now }), before, 2)).toBe(
      true,
    );
  });

  it('first provisioning stopped before publishing: nothing was published yet', () => {
    const desired = buildPublicConfig({ scope, keys: [pending], now });
    expect(rotationMayRepublish(desired, null, 2)).toBe(true);
    expect(rotationMayRepublish(buildPublicConfig({ scope, keys: [active, pending], now }), null, 2)).toBe(false);
  });

  it('rejects anything looser in the database than in the published copy, and any other drift', () => {
    const desired = buildPublicConfig({ scope, keys: [shortened, pending], now });
    // A published epoch ahead of the database.
    const ahead = buildPublicConfig({ scope: { ...scope, authorizationEpoch: 1 }, keys: [active] }).value;
    expect(rotationMayRepublish(buildPublicConfig({ scope, keys: [active], now }), ahead, 2)).toBe(false);
    // A published window shorter than the database's, or a published revocation the database lacks.
    const narrower = buildPublicConfig({ scope, keys: [shortened] }).value;
    expect(rotationMayRepublish(buildPublicConfig({ scope, keys: [active], now }), narrower, 2)).toBe(false);
    const publishedRevoked = buildPublicConfig({ scope, keys: [{ ...active, state: 'revoked' }] }).value;
    expect(rotationMayRepublish(buildPublicConfig({ scope, keys: [active], now }), publishedRevoked, 2)).toBe(false);
    // An unknown key, a swapped public key, another generation, an earlier first day or garbage.
    expect(
      rotationMayRepublish(desired, buildPublicConfig({ scope, keys: [active, key(5, 'active', 1, 9)] }).value, 2),
    ).toBe(false);
    expect(
      rotationMayRepublish(
        desired,
        buildPublicConfig({ scope, keys: [{ ...active, publicKey: pending.publicKey }] }).value,
        2,
      ),
    ).toBe(false);
    const otherGeneration = { ...scope, authorizationGeneration: '11111111-1111-4111-8111-111111111111' };
    expect(rotationMayRepublish(desired, buildPublicConfig({ scope: otherGeneration, keys: [active] }).value, 2)).toBe(
      false,
    );
    expect(
      rotationMayRepublish(desired, buildPublicConfig({ scope, keys: [{ ...active, firstDay: 20699 }] }).value, 2),
    ).toBe(false);
    expect(rotationMayRepublish(desired, '{', 2)).toBe(false);
    expect(rotationMayRepublish(desired, null, 2)).toBe(false);
  });

  it('still tolerates destroyed keys whose window closed', () => {
    const closed = key(9, 'retiring', 20700, 20760);
    const published = buildPublicConfig({ scope, keys: [closed, active] }).value;
    const desired = buildPublicConfig({ scope, keys: [{ ...closed, state: 'destroyed' }, shortened, pending], now });
    expect(rotationMayRepublish(desired, published, 2)).toBe(true);
  });
});
