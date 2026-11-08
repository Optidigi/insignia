import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { buildPublicConfig, publicKeyFingerprint, publicKeyFromSeed } from '@insignia/application';
import { createProductionQuoteReadiness } from '../src/server/production-readiness.ts';
import { coreFixture, releaseEvidenceFixture } from './http-fixtures.mts';

for (const inactive of [false, true]) {
  test(`readiness retains the original public observation time and rejects inactive scope: inactive=${inactive}`, async () => {
    const scope = {
      shopId: 'tenant',
      installationGeneration: '1',
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      authorizationEpoch: 0,
    };
    const instant = new Date('2026-11-01T00:00:00.000Z');
    let current = instant;
    let providerReads = 0;
    const publicKey = publicKeyFromSeed(Buffer.alloc(32, 1));
    const key = {
      ...scope,
      id: 7,
      keyId: 7,
      state: 'active' as const,
      publicKey,
      publicKeyFingerprint: publicKeyFingerprint(publicKey),
      firstDay: 20000,
      lastDay: 23000,
      privateEnvelope: null,
      wrappingKeyId: null,
    };
    const publicConfig = buildPublicConfig({ scope, keys: [key] });
    const core = coreFixture({
      tenants: {
        getActiveAuthorizationScope: async () =>
          inactive ? null : { ...scope, shopDomain: 'synthetic.myshopify.com', shopifyShopId: '9' },
      },
      signingKeys: { getActiveScope: async () => scope, list: async () => [key] },
      acceptedQuotes: {
        getEffective: async () => ({
          configId: 'config',
          operationId: 'operation',
          config: {
            version: 'm2-published-config-v1',
            shopId: 'tenant',
            productId: '111',
            revisionId: 'revision',
            revisionContentHash: 'a'.repeat(64),
            shopCurrency: 'USD',
            methods: [],
            placements: [],
            productionOptions: [],
            pricingRules: [],
          },
        }),
      },
    });
    const read = createProductionQuoteReadiness({
      core,
      ring: { currentKeyId: 'synthetic', keys: { synthetic: Buffer.alloc(32, 1) } },
      selectedKeyId: 7,
      appId: '7',
      expectedFunctions: {
        appKey: 'synthetic-app',
        transformInputQuerySha256: 'a'.repeat(64),
        validationInputQuerySha256: 'c'.repeat(64),
      },
      maxObservationAgeMs: 30000,
      clock: () => current,
      artifactPorts: {
        expectedBuild: { read: async () => releaseEvidenceFixture().expectedBuild },
        trustedEvidence: {
          read: async () => {
            // Yield one event-loop turn so the in-memory public-config read has completed.
            await setImmediate();
            current = new Date(+instant + 40000);
            return releaseEvidenceFixture(current.toISOString(), new Date(+current + 30000).toISOString()).record
              .attestation;
          },
        },
      },
      transport: {
        execute: async (request) => {
          providerReads++;
          return {
            status: 200,
            body: request.query.includes('InsigniaReadPublicConfig')
              ? {
                  data: {
                    shop: {
                      id: 'gid://shopify/Shop/9',
                      field: {
                        owner: { id: 'gid://shopify/Shop/9' },
                        namespace: 'app--7',
                        key: 'insignia_public_config_v2',
                        type: 'json',
                        value: publicConfig.value,
                        compareDigest: '1'.repeat(64),
                      },
                    },
                  },
                }
              : { data: {} },
          };
        },
      },
    });
    await assert.rejects(
      () =>
        read.assertReady({
          quote: {
            ...scope,
            acceptedDay: 20758,
            effectiveRevisions: [
              {
                configId: 'config',
                operationId: 'operation',
                productId: '111',
                revisionId: 'revision',
                contentHash: 'a'.repeat(64),
              },
            ],
          },
        }),
      inactive ? /authorization changed/ : /Public Function config unobserved or drifted/,
    );
    if (inactive) assert.equal(providerReads, 0);
  });
}

function releasePreparationFixture(
  artifacts: NonNullable<Parameters<typeof createProductionQuoteReadiness>[0]['artifactPorts']>,
) {
  const scope = {
    shopId: 'tenant',
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 0,
  };
  const publicKey = publicKeyFromSeed(Buffer.alloc(32, 1));
  let active = true,
    revoked = false,
    providerReads = 0;
  const read = createProductionQuoteReadiness({
    core: coreFixture({
      tenants: {
        getActiveAuthorizationScope: async () =>
          active ? { ...scope, shopDomain: 'synthetic.myshopify.com', shopifyShopId: '9' } : null,
      },
      signingKeys: {
        getActiveScope: async () => scope,
        list: async () => [
          {
            ...scope,
            id: 7,
            keyId: 7,
            state: revoked ? 'revoked' : 'active',
            publicKey,
            publicKeyFingerprint: publicKeyFingerprint(publicKey),
            firstDay: 20000,
            lastDay: 23000,
            privateEnvelope: null,
            wrappingKeyId: null,
          },
        ],
      },
    }),
    ring: { currentKeyId: 'synthetic', keys: { synthetic: Buffer.alloc(32, 1) } },
    selectedKeyId: 7,
    appId: '7',
    expectedFunctions: {
      appKey: 'synthetic-app',
      transformInputQuerySha256: 'a'.repeat(64),
      validationInputQuerySha256: 'c'.repeat(64),
    },
    maxObservationAgeMs: 30000,
    artifactPorts: artifacts,
    transport: {
      execute: async () => {
        providerReads++;
        throw new Error('No provider reads during release-only preparation');
      },
    },
  });
  return {
    read,
    quote: {
      ...scope,
      acceptedDay: 20758,
      effectiveRevisions: [
        {
          configId: 'config',
          operationId: 'operation',
          productId: '111',
          revisionId: 'revision',
          contentHash: 'a'.repeat(64),
        },
      ],
    },
    deactivate: () => {
      active = false;
    },
    revoke: () => {
      revoked = true;
    },
    providerReads: () => providerReads,
  };
}
function preparationGate() {
  let release: () => void = () => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('release-only preparation starts both evidence reads, drains them and retains no approval', async () => {
  const first = preparationGate(),
    second = preparationGate();
  let reads = 0,
    settled = false;
  const evidence = releaseEvidenceFixture();
  const f = releasePreparationFixture({
    expectedBuild: {
      read: async () => {
        reads++;
        await first.promise;
        return evidence.expectedBuild;
      },
    },
    trustedEvidence: {
      read: async () => {
        reads++;
        await second.promise;
        return evidence.record.attestation;
      },
    },
  });
  const work = f.read.prepare({ quote: f.quote }).then(() => {
    settled = true;
  });
  try {
    await setImmediate();
    assert.equal(reads, 2);
    first.release();
    await setImmediate();
    assert.equal(settled, false);
    second.release();
    assert.equal(await work, undefined);
    assert.equal(f.providerReads(), 0);
    await assert.rejects(f.read.assertReady({ quote: f.quote }));
    assert.equal(reads, 4, 'final readiness independently reads evidence instead of using preparation as approval');
  } finally {
    first.release();
    second.release();
    await work;
  }
});

for (const fail of ['expected', 'evidence'] as const) {
  test(`failed ${fail} preparation read drains its pending sibling before returning`, async () => {
    const held = preparationGate();
    let reads = 0,
      settled = false;
    const evidence = releaseEvidenceFixture();
    const f = releasePreparationFixture({
      expectedBuild: {
        read: async () => {
          reads++;
          if (fail === 'expected') throw new Error('Synthetic preparation failure');
          await held.promise;
          return evidence.expectedBuild;
        },
      },
      trustedEvidence: {
        read: async () => {
          reads++;
          if (fail === 'evidence') throw new Error('Synthetic preparation failure');
          await held.promise;
          return evidence.record.attestation;
        },
      },
    });
    const work = f.read.prepare({ quote: f.quote });
    const rejected = assert.rejects(work, /Synthetic preparation failure/).then(() => {
      settled = true;
    });
    try {
      await setImmediate();
      assert.equal(reads, 2);
      assert.equal(settled, false);
      held.release();
      await rejected;
      assert.equal(f.providerReads(), 0);
    } finally {
      held.release();
      await rejected;
    }
  });
}

for (const invalid of ['scope', 'key', 'missing build', 'missing evidence'] as const) {
  test(`release preparation rejects invalid ${invalid} without approving authority`, async () => {
    let reads = 0;
    const evidence = releaseEvidenceFixture();
    const f = releasePreparationFixture({
      expectedBuild: {
        read: async () => {
          reads++;
          return invalid === 'missing build' ? null : evidence.expectedBuild;
        },
      },
      trustedEvidence: {
        read: async () => {
          reads++;
          return invalid === 'missing evidence' ? null : evidence.record.attestation;
        },
      },
    });
    if (invalid === 'scope') f.deactivate();
    if (invalid === 'key') f.revoke();
    await assert.rejects(f.read.prepare({ quote: f.quote }));
    assert.equal(reads, invalid.startsWith('missing') ? 2 : 0);
    assert.equal(f.providerReads(), 0);
  });
}
