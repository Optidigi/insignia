import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admitPublicKey, openSigningSeed, sealSigningSeed } from '../../src/keys/crypto.js';
import { buildPublicConfig, requireIssuanceReady } from '../../src/keys/public-config.js';
import { assertQuoteIssuanceReady } from '../../src/keys/readiness.js';

const scope = {
  shopId: 'shop-a',
  installationGeneration: '1',
  authorizationGeneration: '11111111-1111-4111-8111-111111111111',
  authorizationEpoch: 0,
};
const pair = generateKeyPairSync('ed25519');
const seed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const ring = { currentKeyId: 'local', keys: { local: randomBytes(32) } };

describe('signing key boundary', () => {
  it('seals a seed to its installation identity and rejects tampering or missing key', () => {
    const sealed = sealSigningSeed(ring, scope, 7, seed);
    expect(JSON.stringify(sealed)).not.toContain(seed.toString('hex'));
    expect(openSigningSeed(ring, scope, 7, sealed)).toEqual(seed);
    expect(() => openSigningSeed(ring, { ...scope, installationGeneration: '2' }, 7, sealed)).toThrow();
    expect(() => openSigningSeed(ring, scope, 8, sealed)).toThrow();
    expect(() => openSigningSeed({ currentKeyId: 'other', keys: {} }, scope, 7, sealed)).toThrow();
    expect(() => openSigningSeed(ring, scope, 7, { ...sealed, tag: 'AAAAAAAAAAAAAAAAAAAAAA' })).toThrow();
  });

  it('rejects noncanonical and weak public keys before projection', () => {
    expect(() => admitPublicKey(publicKey)).not.toThrow();
    expect(() => admitPublicKey(Buffer.alloc(32))).toThrow();
    expect(() =>
      admitPublicKey(Buffer.from('edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'hex')),
    ).toThrow();
  });

  it('builds exact deterministic Function config and gates selected issuer coverage', () => {
    const keys = [{ id: 7, publicKey, state: 'active' as const, firstDay: 100, lastDay: 104 }];
    const config = buildPublicConfig({ scope, keys });
    expect(config.value).toBe(
      `{"generationHex":"11111111111141118111111111111111","epoch":0,"maxBuckets":32,"maxPhysicalQuantity":10000,"allowNoMarket":false,"keys":[{"id":7,"publicHex":"${publicKey.toString('hex')}","revoked":false,"firstDay":100,"lastDay":104}]}`,
    );
    expect(() => requireIssuanceReady({ config, keyId: 7, acceptedDay: 102 })).not.toThrow();
    expect(() => requireIssuanceReady({ config, keyId: 7, acceptedDay: 103 })).toThrow();
    const prepublished = buildPublicConfig({
      scope,
      keys: [{ id: 7, publicKey, state: 'pending', firstDay: 100, lastDay: 104 }],
    });
    expect(prepublished.value).toBe(config.value);
    expect(() => requireIssuanceReady({ config: prepublished, keyId: 7, acceptedDay: 102 })).toThrow();
  });

  it('fails closed on drift, stale observation, and unknown Function ownership', () => {
    const desired = buildPublicConfig({
      scope,
      keys: [{ id: 7, publicKey, state: 'active', firstDay: 100, lastDay: 104 }],
    });
    const ready = {
      scope,
      selectedKeyId: 7,
      acceptedDay: 102,
      desired,
      observed: { value: desired.value, observedAt: new Date('2026-09-30T10:00:00Z') },
      now: new Date('2026-09-30T10:00:01Z'),
      maxObservationAgeMs: 30000,
      functions: { transform: 'present' as const, validation: 'present' as const },
      effectiveRevision: true,
    };
    expect(() => assertQuoteIssuanceReady(ready)).not.toThrow();
    expect(() => assertQuoteIssuanceReady({ ...ready, observed: { ...ready.observed, value: '{}' } })).toThrow();
    expect(() => assertQuoteIssuanceReady({ ...ready, now: new Date('2026-09-30T10:01:00Z') })).toThrow();
    expect(() =>
      assertQuoteIssuanceReady({ ...ready, functions: { ...ready.functions, validation: 'unknown' } }),
    ).toThrow();
    expect(() => assertQuoteIssuanceReady({ ...ready, scope: { ...scope, authorizationEpoch: 1 } })).toThrow();
  });
});
