import { createHash, randomUUID } from 'node:crypto';
import { createAdminReadCredentialSource, SigningKeyLifecycle } from '@insignia/application';
import { createDemandDrivenReleaseReader } from '@insignia/shopify';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createProductionBuyerServices } from '../../../apps/web/src/server/buyer/production.ts';
import { fixture } from '../../../apps/web/test/support/buyer-fixture.mts';
import { credentialLifecycle } from '../../../apps/worker/src/handlers.ts';
import { createDurableCore } from '../dist/durable-core.js';

// Diagnostic only: real PostgreSQL repositories and production buyer composition;
// all Shopify/provider facts and release identity are explicitly synthetic.
describe.runIf(Boolean(process.env.DATABASE_URL))('production buyer acceptance composition', () => {
  for (const mode of [
    'current',
    'missing-release',
    'near-expiry',
    'credential-expiring-after-preparation',
    'release-expired-after-preparation',
    'price-drift-before-acceptance',
    'price-drift-after-preparation',
    'entitlement-failure-during-acceptance',
  ] as const) {
    it(`qualifies reviewed proposal acceptance with ${mode}`, async () => {
      const cleanup: (() => Promise<void>)[] = [];
      const f = await fixture({ after: (fn: () => Promise<void>) => cleanup.push(fn) }, { clock: () => new Date() });
      const keys = { currentKeyId: 'composition', keys: { composition: Buffer.alloc(32, 23) } };
      const core = createDurableCore(
        new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 8,
          options: '-c lock_timeout=500ms -c statement_timeout=2000ms',
        }),
        { credentialKeys: keys },
      );
      const append = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        options: '-c lock_timeout=500ms -c statement_timeout=2000ms',
      });
      // The server owns a long-lived core. This fixture must let rejected
      // parallel reads finish before destroying its short-lived database pool.
      const pendingReads = new Set<Promise<unknown>>();
      const trackRead = <T>(read: Promise<T>): Promise<T> => {
        pendingReads.add(read);
        void read.then(
          () => pendingReads.delete(read),
          () => pendingReads.delete(read),
        );
        return read;
      };
      let refreshes = 0,
        passiveReads = 0,
        fenceEntries = 0;
      const credentialErrors: unknown[] = [];
      try {
        await f.pool.query('UPDATE shops SET shop_domain=$2 WHERE shop_id=$1', [f.shopId, `${f.shopId}.myshopify.com`]);
        const scope = await core.tenants.getActiveAuthorizationScope({ shopId: f.shopId, installationGeneration: '1' });
        if (!scope) throw new Error('fixture scope missing');
        const lifecycle = new SigningKeyLifecycle(core.signingKeys, keys);
        await lifecycle.createPending({ scope, keyId: 8, firstDay: 20000, lastDay: 21000, seed: Buffer.alloc(32, 19) });
        await lifecycle.activate(scope, 8);
        const publicConfig = await lifecycle.desiredPublicConfig(scope);
        await core.credentials.install({
          ...scope,
          pair: {
            accessToken: 'synthetic-access',
            refreshToken: 'synthetic-refresh',
            scopes: 'read_products',
            accessExpiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 86400000),
          },
        });
        let accepting = false;
        // Entitlement binding reads provider scope independently from credentials.
        const getProviderScope = core.tenants.getActiveProviderScope.bind(core.tenants);
        core.tenants.getActiveProviderScope = (target) => trackRead(getProviderScope(target));
        const getScope = core.tenants.getActiveAuthorizationScope.bind(core.tenants);
        core.tenants.getActiveAuthorizationScope = (target) => trackRead(getScope(target));
        const acquire = core.credentials.acquire.bind(core.credentials);
        core.credentials.acquire = async (input) => {
          try {
            return await acquire(input);
          } catch (error) {
            credentialErrors.push(error);
            throw error;
          }
        };
        const credentials = createAdminReadCredentialSource({
          tenants: core.tenants,
          credentials: credentialLifecycle(core),
          refresh: {
            refresh: async () => {
              refreshes++;
              return {
                schemaVersion: 'm3-offline-credential-v1',
                accessToken: 'synthetic-new-access',
                refreshToken: 'synthetic-new-refresh',
                scopes: 'read_products',
                accessExpiresAt: new Date(Date.now() + 3600000),
                refreshExpiresAt: new Date(Date.now() + 86400000),
              };
            },
          },
        });
        const acquireActive = credentials.acquire.bind(credentials);
        credentials.acquire = (target) => trackRead(acquireActive(target));
        const query = { transform: 'synthetic-transform-input', validation: 'synthetic-validation-input' };
        const hash = (value: string) => createHash('sha256').update(value).digest('hex');
        const build = {
          schemaVersion: 1 as const,
          shopId: f.shopId,
          installationGeneration: '1',
          appClientId: 'synthetic-app',
          sourceCommit: 'a'.repeat(40),
          appVersionRef: '1163229200385',
          devPreviewRef: null,
          transform: {
            functionId: 'synthetic-transform',
            handle: 'insignia-experimental-v2-transform',
            apiType: 'cart_transform' as const,
            apiVersion: '2026-07',
            inputQuerySha256: hash(query.transform),
            wasmSha256: 'b'.repeat(64),
          },
          validation: {
            functionId: 'synthetic-validation',
            handle: 'insignia-experimental-v2-validation',
            apiType: 'cart_checkout_validation' as const,
            apiVersion: '2026-07',
            inputQuerySha256: hash(query.validation),
            wasmSha256: 'c'.repeat(64),
          },
        };
        const releaseObservedAt = Date.now();
        const record = {
          version: 'm5-trusted-release-v1' as const,
          recordId: randomUUID(),
          activeAppVersionRef: build.appVersionRef,
          attestation: {
            ...build,
            evidenceKind: 'RELEASE_BOUND' as const,
            observedAt: new Date(releaseObservedAt).toISOString(),
            expiresAt: new Date(releaseObservedAt + 30000).toISOString(),
          },
        };
        let missing = false;
        let collections = 0;
        let amount = '10.00';
        let appendError: unknown;
        const reader = createDemandDrivenReleaseReader({
          records: {
            read: async () =>
              missing
                ? null
                : {
                    record,
                    expectedBuild: build,
                    activeVersionEvidenceSha256: 'd'.repeat(64),
                    evidenceDigest: 'e'.repeat(64),
                  },
          },
          binding: {
            ...build,
            authorizationGeneration: scope.authorizationGeneration,
            authorizationEpoch: scope.authorizationEpoch,
            externalInstallationId: 'synthetic-installation',
          },
          isCurrent: async () => {},
          deadline: () => Date.now() + 10000,
          collector: {
            collect: async ({ requestId }) => {
              collections++;
              try {
                // Same real FK boundary as release-append.mjs; no provider or native effects.
                await append.query(
                  `INSERT INTO trusted_release_records(record_id,shop_id,installation_generation,app_client_id,
                active_app_version_ref,expected_build,trusted_record,active_version_observed_at,active_version_evidence_sha256,evidence_digest)
                VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
                  [
                    record.recordId,
                    f.shopId,
                    build.appClientId,
                    build.appVersionRef,
                    build,
                    record,
                    record.attestation.observedAt,
                    'd'.repeat(64),
                    'e'.repeat(64),
                  ],
                );
                missing = false;
                return { requestId, recordId: record.recordId, state: 'COMPLETE' as const };
              } catch (error) {
                appendError = error;
                throw error;
              }
            },
          },
        });
        const shopGid = `gid://shopify/Shop/${scope.shopifyShopId}`;
        const services = createProductionBuyerServices({
          core,
          ring: keys,
          env: {
            SHOPIFY_CLIENT_ID: build.appClientId,
            SHOPIFY_CLIENT_SECRET: 'synthetic-private-secret',
            APP_URL: 'https://synthetic.invalid',
            ARTWORK_PROXY_PATH_PREFIX: '/apps/insignia',
            INSIGNIA_SHOPIFY_APP_ID: '7',
          },
          entitlementPolicy: {
            policyVersion: 'synthetic',
            maxAgeMs: 300000,
            plans: [
              {
                planHandle: 'synthetic-plan',
                billing: 'recurring-only',
                policyId: 'synthetic',
                features: [],
              },
            ],
          },
          // Synthetic qualification isolates actual PostgreSQL acceptance/lock behavior;
          // it does not enable EUR or claim a native primary-Market observation.
          leanContext: {
            async assertSupported(target) {
              expect(target.tenant.shopId).toBe(f.shopId);
              expect(target.tenant.installationGeneration).toBe('1');
              expect(target.country).toBe('NL');
              expect(target.marketId).toBe('42');
              expect(target.currency).toBe('EUR');
              expect(target.shopCurrency).toBe('EUR');
            },
          },
          credentials,
          passiveCredentials: {
            acquire(target) {
              return trackRead(
                (async () => {
                  try {
                    const current = await core.tenants.getActiveProviderScope(target);
                    if (!current) return { kind: 'inactive' };
                    const pair = await core.credentials.readUsable({ ...target, minimumRemainingMs: 30000 });
                    return pair ? { ...pair, shopDomain: current.shopDomain } : { kind: 'temporarily_unavailable' };
                  } catch (error) {
                    credentialErrors.push(error);
                    throw error;
                  } finally {
                    passiveReads++;
                  }
                })(),
              );
            },
          },
          passiveArtifactPorts: {
            expectedBuild: {
              read: async () => (!missing && Date.now() < Date.parse(record.attestation.expiresAt) ? build : null),
            },
            trustedEvidence: {
              read: async () =>
                !missing && Date.now() < Date.parse(record.attestation.expiresAt) ? record.attestation : null,
            },
          },
          maxObservationAgeMs: 30000,
          expectedFunctions: { appKey: build.appClientId },
          artifactPorts: {
            expectedBuild: {
              read: async (scope) =>
                (await reader.read({ scope, expectedActiveAppVersionRef: build.appVersionRef, now: new Date() }))
                  ?.expectedBuild ?? null,
            },
            trustedEvidence: {
              read: async (scope) =>
                (await reader.read({ scope, expectedActiveAppVersionRef: build.appVersionRef, now: new Date() }))
                  ?.record.attestation ?? null,
            },
          },
          readSubscription: async () => {
            if (mode === 'entitlement-failure-during-acceptance' && accepting)
              throw new Error('Synthetic entitlement failure');
            return {
              schemaVersion: 'm4-active-subscription-v1',
              sourceApiVersion: '2026-07',
              appId: 'gid://shopify/App/7',
              shopId: shopGid,
              observedAt: new Date().toISOString(),
              active: true,
              billingPeriod: 'EVERY_30_DAYS',
              cancelAtEndOfCycle: false,
              trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
              currentBillingCycle: null,
              pendingUpdate: null,
              items: [
                {
                  handle: 'synthetic-plan',
                  price: {
                    kind: 'flat',
                    providerTypename: 'FlatRatePrice',
                    active: false,
                    currency: 'USD',
                    amount: '0.00',
                  },
                  usage: null,
                  discount: null,
                },
              ],
            };
          },
          readVariantAvailability: async (target) => {
            const observedAt = Date.now();
            return {
              ...target,
              observedAt: new Date(observedAt).toISOString(),
              freshUntil: new Date(observedAt + 300000).toISOString(),
              variants: [{ id: 'gid://shopify/ProductVariant/222', available: true }],
            };
          },
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            let data: unknown;
            if (body.query.includes('InsigniaShopContext'))
              data = { shop: { id: shopGid, currencyCode: 'EUR', ianaTimezone: 'UTC' } };
            else if (body.query.includes('InsigniaAvailabilityProduct'))
              data = {
                product: {
                  id: `gid://shopify/Product/${f.productId}`,
                  status: 'ACTIVE',
                  variants: { nodes: [{ id: 'gid://shopify/ProductVariant/222' }], pageInfo: { hasNextPage: false } },
                },
              };
            else if (body.query.includes('M5001Product'))
              data = {
                product: {
                  id: `gid://shopify/Product/${f.productId}`,
                  title: 'Synthetic product',
                  status: 'ACTIVE',
                  featuredMedia: null,
                  variants: {
                    nodes: [
                      {
                        id: 'gid://shopify/ProductVariant/222',
                        title: 'Synthetic variant',
                        selectedOptions: [],
                        image: null,
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              };
            else if (body.query.includes('InsigniaVariantContext'))
              data = {
                nodes: [
                  {
                    __typename: 'ProductVariant',
                    id: 'gid://shopify/ProductVariant/222',
                    product: { id: `gid://shopify/Product/${f.productId}` },
                    contextualPricing: { price: { amount, currencyCode: 'EUR' } },
                  },
                ],
              };
            else if (body.query.includes('InsigniaReadPublicConfig'))
              data = {
                shop: {
                  id: shopGid,
                  field: {
                    owner: { id: shopGid },
                    namespace: 'app--7',
                    key: 'insignia_public_config_v2',
                    type: 'json',
                    value: publicConfig.value,
                    compareDigest: 'f'.repeat(64),
                  },
                },
              };
            else if (body.query.includes('InsigniaOwnedFunctions'))
              data = {
                shop: { id: shopGid },
                shopifyFunctions: {
                  nodes: [build.transform, build.validation].map((item) => ({
                    id: item.functionId,
                    handle: item.handle,
                    appKey: build.appClientId,
                    apiVersion: item.apiVersion,
                    apiType: item.apiType,
                    inputQuery: item.apiType === 'cart_transform' ? query.transform : query.validation,
                  })),
                  pageInfo: { hasNextPage: false },
                },
                cartTransforms: {
                  nodes: [
                    {
                      id: 'synthetic-transform-installation',
                      functionId: build.transform.functionId,
                      blockOnFailure: true,
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                },
                validations: {
                  nodes: [
                    {
                      id: 'synthetic-validation-installation',
                      enabled: true,
                      blockOnFailure: true,
                      shopifyFunction: {
                        id: build.validation.functionId,
                        handle: build.validation.handle,
                        appKey: build.appClientId,
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false },
                },
              };
            else throw new Error(`Unexpected synthetic read: ${body.query.slice(0, 60)}`);
            return Response.json({ data });
          },
        });
        const proposal = await services.propose(f.scope, f.body);
        if (mode === 'missing-release') missing = true;
        if (mode === 'near-expiry')
          await f.pool.query(
            "UPDATE shop_credentials SET access_expires_at=clock_timestamp()+interval '20 seconds' WHERE shop_id=$1",
            [f.shopId],
          );
        if (mode === 'price-drift-before-acceptance') amount = '11.00';
        const accept = core.acceptedQuotes.accept.bind(core.acceptedQuotes);
        core.acceptedQuotes.accept = async (input, commit) => {
          fenceEntries++;
          // Changes after the single pre-fence provider pass. Provider facts are not re-read under
          // the lock (owner decision 10 Nov 2026); stored release freshness is applied at signing.
          if (mode === 'credential-expiring-after-preparation')
            await f.pool.query(
              "UPDATE shop_credentials SET access_expires_at=clock_timestamp()+interval '20 seconds' WHERE shop_id=$1",
              [f.shopId],
            );
          if (mode === 'release-expired-after-preparation')
            record.attestation.expiresAt = new Date(Date.now() - 1).toISOString();
          if (mode === 'price-drift-after-preparation') amount = '11.00';
          return accept(input, commit);
        };
        try {
          const acceptanceKey = randomUUID();
          accepting = true;
          const acceptance = services.accept(f.scope, proposal.proposalId, {
            hash: proposal.hash,
            idempotencyKey: acceptanceKey,
          });
          if (
            mode === 'release-expired-after-preparation' ||
            mode === 'price-drift-before-acceptance' ||
            mode === 'entitlement-failure-during-acceptance'
          ) {
            if (mode === 'price-drift-before-acceptance')
              await expect(acceptance).rejects.toMatchObject({ acceptanceOutcome: 'declined' });
            else await expect(acceptance).rejects.toThrow();
            expect(fenceEntries).toBe(mode === 'release-expired-after-preparation' ? 1 : 0);
            if (mode === 'price-drift-before-acceptance') {
              amount = '10.00';
              const retainedRead = core.buyers.getProposal;
              core.buyers.getProposal = async () => {
                throw new Error('Synthetic retained read unavailable');
              };
              try {
                await expect(
                  services.accept(f.scope, proposal.proposalId, { hash: proposal.hash, idempotencyKey: acceptanceKey }),
                ).rejects.toMatchObject({ acceptanceOutcome: 'declined' });
              } finally {
                core.buyers.getProposal = retainedRead;
              }
            }
            expect(credentialErrors).toEqual([]);
            expect(refreshes).toBe(0);
            expect(passiveReads).toBe(0);
            const persisted = await f.pool.query('SELECT quote_id FROM accepted_quotes WHERE shop_id=$1', [f.shopId]);
            expect(persisted.rows).toEqual([]);
            const applications = await f.pool.query('SELECT application_id FROM cart_applications WHERE shop_id=$1', [
              f.shopId,
            ]);
            expect(applications.rows).toEqual([]);
          } else {
            const accepted = await acceptance;
            expect(accepted.quoteId).toBeTruthy();
            if (mode === 'current') {
              const retry = () =>
                services.accept(f.scope, proposal.proposalId, {
                  hash: proposal.hash,
                  idempotencyKey: acceptanceKey,
                });
              // A lost success acknowledgement and duplicate arrivals recover the original receipt/application.
              expect(await Promise.all([retry(), retry()])).toEqual([accepted, accepted]);
              const link = core.buyers.linkQuote;
              core.buyers.linkQuote = async () => {
                throw new Error('synthetic postcommit link failure');
              };
              try {
                await expect(retry()).rejects.toThrow('synthetic postcommit link failure');
              } finally {
                core.buyers.linkQuote = link;
              }
              expect(await retry()).toEqual(accepted);
            }
            expect(refreshes).toBe(mode === 'near-expiry' ? 1 : 0);
            // No provider read, credential refresh or SELECT-only fallback runs under the lock.
            expect(passiveReads).toBe(0);
            if (mode === 'price-drift-after-preparation') expect(accepted.buckets.length).toBeGreaterThan(0);
          }
          expect(collections).toBe(mode === 'missing-release' ? 1 : 0);
        } catch (error) {
          if (appendError) console.error('Synthetic release append error', appendError);
          if (credentialErrors.length) console.error('Synthetic credential errors', credentialErrors);
          throw error;
        }
      } finally {
        // A completed scope read can start its credential read; drain to quiescence.
        while (pendingReads.size) await Promise.allSettled([...pendingReads]);
        await Promise.all([core.close(), append.end()]);
        for (const close of cleanup.reverse()) await close();
      }
    }, 15000);
  }
});
