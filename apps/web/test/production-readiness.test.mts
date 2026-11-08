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
