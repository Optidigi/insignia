import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { buildPublicConfig, publicKeyFingerprint, publicKeyFromSeed } from '@insignia/application';
import { createProductionQuoteReadiness } from '../src/server/production-readiness.ts';
import { coreFixture, effectiveRevision, releaseEvidenceFixture } from './http-fixtures.mts';

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
      selectedKeyId: 7,
      appId: '7',
      expectedFunctions: { appKey: 'synthetic-app' },
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

type ReadinessInput = Parameters<typeof createProductionQuoteReadiness>[0];
function releasePreparationFixture(
  artifacts: NonNullable<ReadinessInput['artifactPorts']>,
  options: { transport?: ReadinessInput['transport']; clock?: () => Date } = {},
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
    selectedKeyId: 7,
    appId: '7',
    expectedFunctions: { appKey: 'synthetic-app' },
    maxObservationAgeMs: 30000,
    artifactPorts: artifacts,
    ...(options.clock ? { clock: options.clock } : {}),
    transport: {
      execute: async (request) => {
        providerReads++;
        if (!options.transport) throw new Error('Synthetic provider unavailable');
        return options.transport.execute(request);
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

function publicConfigTransport(value: string): ReadinessInput['transport'] {
  return {
    execute: async (request) => ({
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
                  value,
                  compareDigest: '1'.repeat(64),
                },
              },
            },
          }
        : { data: {} },
    }),
  };
}

test('observation reads provider and release evidence once; the fenced check applies freshness at signing', async () => {
  const instant = new Date('2026-11-01T00:00:00.000Z');
  let current = instant,
    reads = 0;
  const evidence = releaseEvidenceFixture(instant.toISOString(), new Date(+instant + 30000).toISOString());
  const scope = {
    shopId: 'tenant',
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 0,
  };
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
  const f = releasePreparationFixture(
    {
      expectedBuild: {
        read: async () => {
          reads++;
          return evidence.expectedBuild;
        },
      },
      trustedEvidence: {
        read: async () => {
          reads++;
          return evidence.record.attestation;
        },
      },
    },
    { transport: publicConfigTransport(buildPublicConfig({ scope, keys: [key] }).value), clock: () => current },
  );
  const observation = await f.read.observe({ quote: f.quote });
  const observed = { reads, providerReads: f.providerReads() };
  assert.equal(observed.reads, 2);
  assert.ok(observed.providerReads >= 2, 'public config and Function ownership observed before the fence');
  // The synthetic Function ownership is absent, so a current check fails after the freshness checks.
  await assert.rejects(observation.assertCurrent(), /Required Function pair not ready/);
  current = new Date(+instant + 30001);
  await assert.rejects(observation.assertCurrent(), /Public Function config unobserved or drifted/);
  assert.deepEqual(
    { reads, providerReads: f.providerReads() },
    observed,
    'the fenced check reads no provider or release',
  );
});

for (const fail of ['expected', 'evidence'] as const) {
  test(`failed ${fail} release read drains its pending siblings before the observation rejects`, async () => {
    const held = preparationGate();
    let reads = 0,
      settled = false;
    const evidence = releaseEvidenceFixture();
    const f = releasePreparationFixture({
      expectedBuild: {
        read: async () => {
          reads++;
          if (fail === 'expected') throw new Error('Synthetic release failure');
          await held.promise;
          return evidence.expectedBuild;
        },
      },
      trustedEvidence: {
        read: async () => {
          reads++;
          if (fail === 'evidence') throw new Error('Synthetic release failure');
          await held.promise;
          return evidence.record.attestation;
        },
      },
    });
    const work = f.read.observe({ quote: f.quote });
    const rejected = assert.rejects(work).then(() => {
      settled = true;
    });
    try {
      await setImmediate();
      assert.equal(reads, 2);
      assert.equal(settled, false);
      held.release();
      await rejected;
    } finally {
      held.release();
      await rejected;
    }
  });
}

test('an inactive installation rejects observation before provider or release reads', async () => {
  let reads = 0;
  const evidence = releaseEvidenceFixture();
  const f = releasePreparationFixture({
    expectedBuild: {
      read: async () => {
        reads++;
        return evidence.expectedBuild;
      },
    },
    trustedEvidence: {
      read: async () => {
        reads++;
        return evidence.record.attestation;
      },
    },
  });
  f.deactivate();
  await assert.rejects(f.read.observe({ quote: f.quote }), /authorization changed/);
  assert.equal(reads, 0);
  assert.equal(f.providerReads(), 0);
});

test('a revoked signing key fails the fenced check without new reads', async () => {
  const evidence = releaseEvidenceFixture();
  let reads = 0;
  const f = releasePreparationFixture({
    expectedBuild: {
      read: async () => {
        reads++;
        return evidence.expectedBuild;
      },
    },
    trustedEvidence: {
      read: async () => {
        reads++;
        return evidence.record.attestation;
      },
    },
  });
  f.revoke();
  await assert.rejects(f.read.assertReady({ quote: f.quote }));
  assert.equal(reads, 2);
});

// Live Shopify Admin currently returns `inputQuery: null` (observation v2); the
// trusted release record is then the only query authority. When Admin does
// return a query, it is compared with that same record, never with a separately
// maintained operator value that can drift at each Function release.
for (const live of ['unobservable', 'release-query', 'other-query', 'missing-build'] as const) {
  test(`buyer readiness derives Function query authority from the trusted release: ${live}`, async () => {
    const queries = {
      transform: 'query Transform { cart { lines { id } } }',
      validation: 'query Validation { shop { id } }',
    };
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const scope = {
      shopId: 'tenant',
      installationGeneration: '1',
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      authorizationEpoch: 0,
    };
    const now = new Date();
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
    const evidence = releaseEvidenceFixture(now.toISOString(), new Date(+now + 30000).toISOString());
    const handles = {
      transform: 'insignia-experimental-v2-transform',
      validation: 'insignia-experimental-v2-validation',
    };
    const build = {
      ...evidence.expectedBuild,
      transform: {
        ...evidence.expectedBuild.transform,
        handle: handles.transform,
        inputQuerySha256: digest(queries.transform),
      },
      validation: {
        ...evidence.expectedBuild.validation,
        handle: handles.validation,
        inputQuerySha256: digest(queries.validation),
      },
    };
    const attestation = { ...evidence.record.attestation, transform: build.transform, validation: build.validation };
    const liveQuery = (surface: 'transform' | 'validation') =>
      live === 'unobservable' || live === 'missing-build'
        ? null
        : live === 'other-query'
          ? 'query Other { shop { id } }'
          : queries[surface];
    const functions = (['transform', 'validation'] as const).map((surface) => ({
      id: build[surface].functionId,
      handle: handles[surface],
      appKey: 'synthetic-app',
      apiType: build[surface].apiType,
      apiVersion: '2026-07',
      inputQuery: liveQuery(surface),
    }));
    const read = createProductionQuoteReadiness({
      core: coreFixture({
        tenants: {
          getActiveAuthorizationScope: async () => ({
            ...scope,
            shopDomain: 'synthetic.myshopify.com',
            shopifyShopId: '9',
          }),
        },
        signingKeys: { getActiveScope: async () => scope, list: async () => [key] },
        acceptedQuotes: {
          getEffective: async () => effectiveRevision(),
        },
      }),
      selectedKeyId: 7,
      appId: '7',
      expectedFunctions: { appKey: 'synthetic-app' },
      maxObservationAgeMs: 30000,
      clock: () => now,
      artifactPorts: {
        expectedBuild: { read: async () => (live === 'missing-build' ? null : build) },
        trustedEvidence: { read: async () => attestation },
      },
      transport: {
        execute: async (request) => ({
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
            : {
                data: {
                  shop: { id: 'gid://shopify/Shop/9' },
                  shopifyFunctions: { nodes: functions, pageInfo: { hasNextPage: false } },
                  cartTransforms: {
                    nodes: [{ id: 'cart-transform', functionId: build.transform.functionId, blockOnFailure: true }],
                    pageInfo: { hasNextPage: false },
                  },
                  validations: {
                    nodes: [{ id: 'validation', enabled: true, blockOnFailure: true, shopifyFunction: functions[1] }],
                    pageInfo: { hasNextPage: false },
                  },
                },
              },
        }),
      },
    });
    const ready = read.assertReady({
      quote: {
        ...scope,
        acceptedDay: 20758,
        effectiveRevisions: [
          {
            configId: 'configuration',
            operationId: 'publication',
            productId: '123',
            revisionId: 'revision',
            contentHash: 'a'.repeat(64),
          },
        ],
      },
    });
    if (live === 'other-query') await assert.rejects(ready, /Required Function pair not ready/);
    else if (live === 'missing-build') await assert.rejects(ready, /expected build unavailable/);
    else assert.equal(await ready, undefined);
  });
}
